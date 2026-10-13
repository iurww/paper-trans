import { alignVisualPage } from './alignment-api.js';
import { alignmentInputs, alignmentMatches, withParagraphFallback } from './sentence-alignment.js';

const emptyTokens = () => ({ prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 });

export function createAlignmentRunner({ get, update, notify = () => {}, align = alignVisualPage }) {
  const running = new Set();
  const save = async (id, patch) => notify(await update(id, current => ({ ...current, ...patch })));
  const complete = async id => {
    const record = await update(id, current => {
      const inputs = alignmentInputs(current.visualPages);
      const sentenceAlignments = [...(current.sentenceAlignments || [])];
      for (const page of current.visualPages) {
        if (page && !alignmentMatches(sentenceAlignments[page.number - 1], inputs[page.number - 1])) {
          sentenceAlignments[page.number - 1] = withParagraphFallback(sentenceAlignments[page.number - 1], inputs[page.number - 1], page.number);
        }
      }
      return { ...current, ...(sentenceAlignments.some(Boolean) ? { sentenceAlignments } : {}),
        alignmentStatus: 'done', alignmentError: '', alignmentPageErrors: {}, alignmentFailureInputs: {} };
    });
    notify(record);
    return record;
  };
  return async function run(id, key, { retry = false, onlyPage = null, redoPage = false } = {}) {
    if (running.has(id)) return;
    running.add(id);
    try {
      let initial = await get(id);
      if (!initial || !(initial.visualPages || []).some(Boolean)) return;
      const inputs = alignmentInputs(initial.visualPages);
      // Migrate old failed pages locally, retaining any successful sentences.
      if (initial.alignmentStatus === 'error' || !key) {
        initial = await complete(id);
      }
      const pages = initial.visualPages.flatMap((page, index) => {
        if (!page || onlyPage && page.number !== onlyPage) return [];
        if (!redoPage && alignmentMatches(initial.sentenceAlignments?.[index], inputs[index])) return [];
        return [{ number: page.number, input: inputs[index] }];
      });
      if (!pages.length) {
        if (initial.alignmentStatus !== 'done') await complete(id);
        return;
      }
      await save(id, { alignmentStatus: 'working', alignmentError: '' });
      await Promise.all(pages.map(async ({ number, input }) => {
        await update(id, current => {
          const alignmentPageErrors = { ...current.alignmentPageErrors };
          delete alignmentPageErrors[number];
          return { ...current, alignmentPageErrors };
        }).then(notify);
        let result, error;
        try { result = await align(input, number, key, {
          previousAlignment: initial.sentenceAlignments?.[number - 1],
          onProgress: async alignment => notify(await update(id, current => {
            if (JSON.stringify(alignmentInputs(current.visualPages)[number - 1]) !== JSON.stringify(input)) return current;
            const sentenceAlignments = [...(current.sentenceAlignments || [])];
            sentenceAlignments[number - 1] = alignment;
            return { ...current, sentenceAlignments };
          })),
        }); }
        catch (failure) { error = failure; }
        notify(await update(id, current => {
          const previous = current.alignmentTokens || emptyTokens();
          const usage = result?.usage || error?.usage || {};
          const alignmentTokens = {
            prompt: previous.prompt + (usage.prompt_tokens || 0),
            completion: previous.completion + (usage.completion_tokens || 0),
            total: previous.total + (usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
            cacheHit: (previous.cacheHit || 0) + (usage.prompt_cache_hit_tokens || 0),
            cacheMiss: (previous.cacheMiss || 0) + (usage.prompt_cache_miss_tokens || 0),
          };
          // Count paid requests but never attach a stale mapping after re-OCR.
          if (JSON.stringify(alignmentInputs(current.visualPages)[number - 1]) !== JSON.stringify(input)) {
            return { ...current, alignmentTokens };
          }
          const sentenceAlignments = [...(current.sentenceAlignments || [])];
          const alignmentPageErrors = { ...current.alignmentPageErrors };
          const alignmentFailureInputs = { ...current.alignmentFailureInputs };
          if (result) {
            sentenceAlignments[number - 1] = result.alignment;
            delete alignmentPageErrors[number];
            delete alignmentFailureInputs[number];
          } else {
            sentenceAlignments[number - 1] = withParagraphFallback(error.partialAlignment || sentenceAlignments[number - 1], input, number);
            delete alignmentPageErrors[number];
            delete alignmentFailureInputs[number];
          }
          return { ...current, sentenceAlignments, alignmentPageErrors, alignmentFailureInputs, alignmentTokens };
        }));
      }));
      await complete(id);
    } catch (error) {
      await save(id, { alignmentStatus: 'error', alignmentError: error.message || String(error) });
    } finally { running.delete(id); }
  };
}
