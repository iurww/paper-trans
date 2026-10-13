import { request, parseContent, RetryableTranslationError, TranslationConfigurationError } from './translation-api.js';
import { DEEPSEEK_VISION_ENDPOINT, DEEPSEEK_VISION_MODEL } from './vision-api.js';
import { ALIGNMENT_VERSION, alignmentCurrent, candidateInput, validateCandidateParagraph } from './sentence-alignment.js';

const prompt = `Match the original and Chinese sentences by meaning. Input sentences have zero-based array indices. Return only JSON:
{"paragraphs":[{"paragraph":0,"links":[{"original":[0],"chinese":[0]}]}]}
Return every paragraph ID and cover every sentence index on both sides. Use the smallest faithful groups; allow split, merged or reordered translations. Return indices only, never copy or rewrite text. If no faithful match exists, return that paragraph with "error":"unalignable".`;

export function addAlignmentUsage(total, usage = {}) {
  total.prompt_tokens += usage.prompt_tokens || 0;
  total.completion_tokens += usage.completion_tokens || 0;
  total.total_tokens += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  total.prompt_cache_hit_tokens += usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  total.prompt_cache_miss_tokens += usage.prompt_cache_miss_tokens ?? Math.max(0,
    (usage.prompt_tokens || 0) - (usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0));
}

export async function alignVisualPage(input, page, key, { fetchImpl = fetch, sleep, previousAlignment, onProgress } = {}) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 };
  const accepted = new Map(alignmentCurrent(previousAlignment, input)
    ? previousAlignment.paragraphs.map(item => [item.paragraph, item]) : []);
  const snapshot = () => ({ version: ALIGNMENT_VERSION, number: page, input,
    paragraphs: [...accepted.values()].sort((a, b) => a.paragraph - b.paragraph) });
  if (!input.length || accepted.size === input.length) return { alignment: snapshot(), usage };
  if (!key) throw new TranslationConfigurationError('请先在 API 设置中填写 DeepSeek API Key');
  const candidates = candidateInput(input);
  const pending = () => candidates.filter(item => !accepted.has(item.paragraph));
  const collect = async (parsed, requested) => {
    const items = Array.isArray(parsed?.paragraphs) ? parsed.paragraphs
      : requested.length === 1 && Array.isArray(parsed?.links)
        ? [{ ...parsed, paragraph: parsed.paragraph ?? requested[0].paragraph }] : [];
    const paragraphId = item => typeof item?.paragraph === 'string' && /^\d+$/.test(item.paragraph)
      ? Number(item.paragraph) : item?.paragraph;
    for (const candidate of requested) {
      const matches = items.filter(item => paragraphId(item) === candidate.paragraph);
      if (matches.length !== 1) continue;
      const basis = input.find(item => item.paragraph === candidate.paragraph);
      const validated = validateCandidateParagraph({ ...matches[0], paragraph: candidate.paragraph }, basis, candidate, page);
      if (validated) accepted.set(candidate.paragraph, validated);
    }
    if (accepted.size && onProgress) await onProgress(snapshot());
  };
  const call = async (requested, maxTokens, repair = false) => {
    const messages = [{ role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify({ paragraphs: requested }) }];
    if (repair) messages.push({ role: 'user', content: 'The previous response was incomplete or invalid. Return all listed IDs, with every index covered, in valid JSON.' });
    const data = await request(messages, {
      endpoint: DEEPSEEK_VISION_ENDPOINT, model: DEEPSEEK_VISION_MODEL, key,
      maxTokens, thinking: { type: 'disabled' }, timeoutMs: 240000,
    }, fetchImpl, sleep);
    addAlignmentUsage(usage, data.usage);
    // Truncated output is never accepted as a complete mapping.
    if (data.choices?.[0]?.finish_reason !== 'length') {
      await collect(parseContent(data.choices?.[0]?.message?.content), requested);
    }
  };
  try {
    await call(pending(), 8192);
    // Keep valid paragraphs; only repair missing ones in small requests. This
    // avoids repeating a large page and keeps malformed JSON local to one item.
    for (const candidate of pending()) {
      for (let attempt = 0; attempt < 3 && !accepted.has(candidate.paragraph); attempt++) {
        await call([candidate], 2048 * 2 ** attempt, true);
      }
    }
    if (accepted.size !== input.length) {
      const missing = input.filter(item => !accepted.has(item.paragraph)).map(item => item.paragraph + 1);
      throw new RetryableTranslationError(`第 ${missing.join('、')} 段尚未得到完整、有效的句子对应；已保留其他段落，可重试补齐`);
    }
    return { alignment: snapshot(), usage };
  } catch (error) {
    error.usage = usage;
    if (accepted.size) error.partialAlignment = snapshot();
    throw error;
  }
}
