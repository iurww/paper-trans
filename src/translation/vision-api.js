import { parseContent, request, RetryableTranslationError, TranslationConfigurationError } from './translation-api.js';
import { isOriginalOnlyVisualItem, omitVisualItem } from './visual-content.js';

export const DEEPSEEK_VISION_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash';
export const DEFAULT_VISION_THINKING = 'enabled';

import { SENTENCE_SEPARATOR } from '../alignment/sentence-separator.js';

const kinds = new Set(['title', 'heading', 'paragraph', 'equation', 'caption', 'list', 'table', 'footnote', 'reference', 'author', 'affiliation', 'contact']);
const prompt = `Read this complete academic PDF page visually and translate it into Simplified Chinese. Return ONLY a JSON object of this form:
{"paragraphs":[{"kind":"paragraph","original":"original-language text with LaTeX","chinese":"Chinese translation with LaTeX"}]}
MANDATORY BILINGUAL SENTENCE PROTOCOL (applies to EVERY bilingual kind, including paragraph, list, caption, footnote, heading and title):
1. For each item, FIRST identify the finest natural semantic units in the ORIGINAL. Each complete sentence is a separate unit, even WITHIN the SAME bullet/numbered item. A numbered item containing a claim followed by a separate explanatory sentence needs TWO units, not one; being about the same topic does not justify merging complete sentences. Separate consecutive list entries even if they lack full stops or appear on the SAME line (for example two bullet symbols or independently numbered assertions 1)...; 2)...). Keep the introduction with the first entry; start a new unit at every following independent entry. Separate a complete sentence from a following sentence fragment introducing a formula. A short introductory LABEL is not a sentence even if printed with a final period. Attach it to the following explanatory sentence or list entry in the SAME unit; do not attach a new label to the END of the preceding unit. This applies to bold/italic labels too. A semicolon followed by a NEW labeled item starts a NEW unit before that label; never combine the previous item's explanation with the new item's heading and explanation. Keep a comma-separated Keywords line as ONE unit; ordinary enumerations inside a sentence are not separate list entries. A page-start continuation fragment must be a separate unit from the next new sentence, even if the printed punctuation is a comma. Sentence boundaries remain mandatory when the next sentence begins with an inline formula, e.g. "... patterns. ${SENTENCE_SEPARATOR}$k$ is the window size." The formula stays intact inside the new unit. Do not split words, mathematical expressions or dependent clauses just to make shorter units.
2. Build original as those units joined with the EXACT reserved boundary token ${SENTENCE_SEPARATOR}. Then translate EACH original unit individually in the SAME order, and build chinese by joining its corresponding translations with the SAME token. Even if a Chinese translation uses multiple sentences for one original unit, keep them together inside that unit. Never merge separate original sentences into one unit when each can be translated independently.
3. For EVERY bilingual item, count(original, "${SENTENCE_SEPARATOR}") MUST EQUAL count(chinese, "${SENTENCE_SEPARATOR}"). There MUST be a separator in BOTH fields whenever there are two or more units. Putting separators only in chinese or only in original is INVALID. Equal counts alone are insufficient: the nth unit on both sides MUST convey the same meaning.
4. Preserve complete source wording and sentence order. Insert this token between units only, never at the start/end, never next to another token, never inside math, a Markdown delimiter, LaTeX command, word or citation. Boundaries may cross emphasized prose. Preserve natural spacing, using a space before the token for English sentences and no added spaces around the token for Chinese.
5. Original-only authors, affiliations, contacts, references and standalone equations have chinese="" and NO separators. One natural unit has zero separators in BOTH fields. Do not add fields, sentence arrays, IDs, commentary or analysis: keep the paragraph schema unchanged.
EXAMPLES (the same rule applies to prose, bullet points and captions):
{"kind":"list","original":"- First entry. ${SENTENCE_SEPARATOR}- Second entry.","chinese":"- 第一项。${SENTENCE_SEPARATOR}- 第二项。"}
{"kind":"paragraph","original":"Two issues: 1) First issue; ${SENTENCE_SEPARATOR}2) Second issue.","chinese":"两个问题：1）第一个问题；${SENTENCE_SEPARATOR}2）第二个问题。"}
{"kind":"paragraph","original":"**Memory unit.** It stores history. ${SENTENCE_SEPARATOR}**Another unit.** It stores recent events.","chinese":"**记忆单元。** 它存储历史。${SENTENCE_SEPARATOR}**另一单元。** 它存储近期事件。"}
{"kind":"paragraph","original":"*First unit.* It stores history. ${SENTENCE_SEPARATOR}It behaves like long-term storage; ${SENTENCE_SEPARATOR}*Second unit.* It stores recent events.","chinese":"*第一单元。* 它存储历史。${SENTENCE_SEPARATOR}它类似长期存储；${SENTENCE_SEPARATOR}*第二单元。* 它存储近期事件。"}
{"kind":"paragraph","original":"The model captures patterns. ${SENTENCE_SEPARATOR}$k$ is the window size.","chinese":"模型捕捉模式。${SENTENCE_SEPARATOR}$k$ 是窗口大小。"}
{"kind":"paragraph","original":"First sentence. ${SENTENCE_SEPARATOR}Second sentence. ${SENTENCE_SEPARATOR}The optimization problem is","chinese":"第一句。${SENTENCE_SEPARATOR}第二句。${SENTENCE_SEPARATOR}优化问题为"}
{"kind":"list","original":"- Local search: Sample a configuration. ${SENTENCE_SEPARATOR}Update it if better. ${SENTENCE_SEPARATOR}Repeat three times.","chinese":"- 局部搜索：采样一个配置。${SENTENCE_SEPARATOR}如果更好则更新。${SENTENCE_SEPARATOR}重复三次。"}
{"kind":"caption","original":"Figure 1: Method overview. ${SENTENCE_SEPARATOR}Adapted from Smith (2020).","chinese":"图1：方法概述。${SENTENCE_SEPARATOR}改编自Smith（2020）。"}
FINAL CHECK BEFORE RETURNING: Inspect EVERY bilingual item, including the first and last items on the page. Fix any unequal token counts in the output itself. A multi-sentence original without boundary tokens is INVALID even when the Chinese has them. Do not omit separators because a paragraph is long, is a list, or is adjacent to a formula. Return only the completed JSON.
PAGE EXTRACTION AND FORMATTING RULES:
Follow the page's reading order, including two-column layout. Keep visible prose paragraphs, headings, equations, and captions outside tables as separate items. CRITICAL: Do not transcribe, translate, summarize, or output ANY content inside a table, even when a cell contains long paragraphs of text. Skip table cells, row and column headers, and table numbers inside the grid. A border or colored background alone does NOT make a table: include prose, lists and equations in explanatory boxes or chat/example panels, even when these panels are part of a figure. Treat only genuinely tabular row/column data as a table. A table caption outside the grid may be translated. Include author names, author affiliations, institutions, postal addresses, and email/contact lines as separate items with kind author, affiliation, or contact; transcribe their original content exactly once in original and set chinese to an empty string. Include the References/Bibliography heading and every bibliography entry in reading order; use kind heading for the heading and kind reference for each entry, transcribe their original text, and set chinese to an empty string. Never translate author metadata or references. Skip standalone printed page numbers and running headers. Do not invent text. For each other included item, transcribe the actual original-language content from the image in original, then translate it in chinese. Preserve citations, numbering, symbols, and the logical paper structure. Preserve bold and italic emphasis with Markdown **bold** and *italic* markers in BOTH fields. The viewer renders math with KaTeX, so produce KaTeX-compatible LaTeX syntax only. Wrap EVERY inline formula in $...$ and EVERY displayed or numbered formula in $$...$$; a standalone displayed formula must be a separate item with kind equation, original containing the full $$...$$ formula and chinese set to an empty string. Put equation numbers inside the display math as \\tag{8}, for example $$f(x)=x^2 \\tag{8}$$. Never put \\tag outside $$...$$, never emit a bare LaTeX equation, and do not use full-LaTeX document commands or unsupported packages. Preserve the mathematical meaning, equation numbers, and variable names exactly; do not translate LaTeX commands. Use kind title, heading, paragraph, equation, caption, list, footnote, author, affiliation, contact or reference. A page containing only a table has an empty paragraphs array. Escape backslashes correctly in JSON.

FINAL REMINDER: Build original with ${SENTENCE_SEPARATOR} at EVERY sentence/independent list-entry boundary, THEN translate those units one by one into chinese with exactly the same boundaries. Check BOTH fields, not only chinese. Return JSON only.`;

export function parseVisualPage(content) {
  const parsed = parseContent(content);
  if (!Array.isArray(parsed?.paragraphs)) return null;
  const paragraphs = [];
  let invalid = 0;
  for (const item of parsed.paragraphs) {
    if (omitVisualItem(item)) continue;
    const metadata = isOriginalOnlyVisualItem(item) || item?.kind === 'equation';
    const original = typeof item?.original === 'string' ? item.original.trim() : '';
    const chinese = metadata || typeof item?.chinese !== 'string' ? '' : item.chinese.trim();
    if (!original || (!metadata && !chinese)) { invalid++; continue; }
    paragraphs.push({ kind: kinds.has(item.kind) ? item.kind : 'paragraph', original, chinese });
  }
  if (!paragraphs.length && invalid) return null;
  return paragraphs;
}

function addUsage(total, usage = {}) {
  total.prompt_tokens += usage.prompt_tokens || 0;
  total.completion_tokens += usage.completion_tokens || 0;
  total.total_tokens += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
}

async function requestVisual(imageUrl, key, promptText, maxTokens, fetchImpl, sleep, thinking) {
  const settings = { endpoint: DEEPSEEK_VISION_ENDPOINT, model: DEEPSEEK_VISION_MODEL, key,
    maxTokens, thinking: { type: thinking }, timeoutMs: 240000 };
  return request([{ role: 'user', content: [
    { type: 'text', text: promptText },
    { type: 'image_url', image_url: { url: imageUrl, detail: 'original' } },
  ] }], settings, fetchImpl, sleep);
}

async function translateInChunks(imageUrl, key, usage, fetchImpl, sleep, thinking) {
  const paragraphs = [];
  const seen = new Set();
  for (let chunk = 0; chunk < 16; chunk++) {
    const anchor = paragraphs.at(-1)?.original.slice(-500);
    const instruction = `${prompt}\nFor this response, return at most 8 consecutive paragraphs in reading order. This batch limit overrides the earlier instruction to return the whole page at once. ` +
      (anchor ? `Continue immediately AFTER the paragraph ending with this exact original-language text: ${JSON.stringify(anchor)}. Do not repeat any earlier paragraph.`
        : 'Start at the very beginning of the page.') +
      ' Add a boolean has_more field to the JSON object: true if there are still visible paragraphs after this batch, false if this is the end of the page. Example shape: {"paragraphs":[{"kind":"paragraph","original":"...","chinese":"..."}],"has_more":true}. Never omit has_more.';
    let accepted = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await requestVisual(imageUrl, key, instruction, 12000, fetchImpl, sleep, thinking);
      addUsage(usage, data.usage);
      const parsed = parseContent(data.choices?.[0]?.message?.content);
      const batch = parseVisualPage(data.choices?.[0]?.message?.content);
      if (!batch || typeof parsed.has_more !== 'boolean' || data.choices?.[0]?.finish_reason === 'length') continue;
      const fresh = batch.filter(item => !seen.has(item.original));
      if (!fresh.length && (parsed.has_more || chunk > 0)) continue;
      for (const item of fresh) { paragraphs.push(item); seen.add(item.original); }
      if (!parsed.has_more) return paragraphs;
      accepted = true;
      break;
    }
    if (!accepted) break;
  }
  const error = new RetryableTranslationError('DeepSeek 分批返回的逐段 JSON 仍不完整');
  error.usage = usage;
  throw error;
}

export async function translateVisualPage(imageUrl, key, { fetchImpl = fetch, sleep, thinking = DEFAULT_VISION_THINKING } = {}) {
  if (!['enabled', 'disabled'].includes(thinking)) throw new TranslationConfigurationError('无效的视觉模型思考模式');
  if (!key) throw new TranslationConfigurationError('请先在 API 设置中填写 DeepSeek API Key');
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await requestVisual(imageUrl, key, prompt, attempt ? 64000 : 32000, fetchImpl, sleep, thinking);
      addUsage(usage, data.usage);
      const paragraphs = parseVisualPage(data.choices?.[0]?.message?.content);
      if (paragraphs && data.choices?.[0]?.finish_reason !== 'length') return { paragraphs, usage };
      if (attempt === 0 && sleep) await sleep(500);
    }
    return { paragraphs: await translateInChunks(imageUrl, key, usage, fetchImpl, sleep, thinking), usage };
  } catch (error) {
    error.usage ||= usage;
    throw error;
  }
}
