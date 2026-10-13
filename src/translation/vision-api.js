import { parseContent, request, RetryableTranslationError, TranslationConfigurationError } from './translation-api.js';
import { isOriginalOnlyVisualItem, omitVisualItem } from './visual-content.js';

export const DEEPSEEK_VISION_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash';
export const DEFAULT_VISION_THINKING = 'disabled';

import { SENTENCE_SEPARATOR } from '../alignment/sentence-separator.js';

const kinds = new Set(['title', 'heading', 'paragraph', 'equation', 'caption', 'list', 'table', 'footnote', 'reference', 'author', 'affiliation', 'contact']);
const prompt = `Keep each complete visual paragraph in the paper as ONE JSON paragraph item, and each complete list entry as ONE JSON list item. Do NOT split a paragraph or list entry into multiple JSON items sentence by sentence. Insert ${SENTENCE_SEPARATOR} ONLY BETWEEN sentences INSIDE the original and chinese strings of that same item, with one original sentence corresponding to one translated sentence and equal separator counts.

Read this academic PDF page in reading order, including two-column layouts, and translate it into Simplified Chinese.

OUTPUT
Return only JSON:
{"paragraphs":[{"kind":"paragraph","original":"Original sentence 1. ${SENTENCE_SEPARATOR}Original sentence 2.","chinese":"翻译句1。${SENTENCE_SEPARATOR}翻译句2。"}]}
For kind="paragraph" and kind="list", original and chinese are sentence texts separated by ${SENTENCE_SEPARATOR}, not undivided multi-sentence text.
Use kind: title, heading, paragraph, equation, caption, list, footnote, reference, author, affiliation or contact. Preserve source wording, citations, numbering, symbols and paragraph structure. Define each kind="paragraph" item by the actual visual paragraph in the paper, using cues such as paragraph indentation and bold or italic text at the paragraph beginning. One real paragraph must be one JSON paragraph item; do not turn each sentence into a separate paragraph item. Insert sentence separators within that item. Preserve bold and italic text using Markdown **bold** and *italic* in both languages. Escape backslashes correctly in JSON.

CONTENT
Recognize only formal document text: headings, body paragraphs, lists, equations and footnotes. Do not recognize text inside images or figures, including labels, explanatory boxes and example panels. Skip table contents, printed page numbers and running headers. For figures and tables, retain only their captions or notes beginning with "Figure xx:" or "Table xx", where xx is the figure or table number. Transcribe authors, affiliations, contact information, the References/Bibliography heading and bibliography entries only in original, with chinese="". Translate the other text without inventing content.

SENTENCE SEPARATION
For EVERY kind="paragraph" and kind="list" item, insert ${SENTENCE_SEPARATOR} between sentences in both original and chinese. Use English full stops (.) and semicolons (;) as sentence-boundary cues. Treat semicolon-separated items as independent sentences, including inline numbered lists such as "1) ...; 2) ...;" and "i) ...; ii) ...;", and insert a separator between those items. One original sentence corresponds to one translated sentence, and both fields must contain the same number of separators.

MATHEMATICS
Use KaTeX-compatible LaTeX. Wrap every inline formula in $...$ and every displayed or numbered formula in $$...$$. Output standalone display equations as separate kind="equation" items with the complete formula in original and chinese="". Put equation numbers inside display math as \\tag{8}, for example $$f(x)=x^2 \\tag{8}$$; never place \\tag outside $$...$$ or output bare LaTeX equations. Preserve mathematical meaning, equation numbers and variable names; do not translate LaTeX commands or use full-LaTeX document commands or unsupported packages.

FINAL REMINDER
If a JSON paragraph item contains multiple English sentences, always insert ${SENTENCE_SEPARATOR} within original and chinese according to the sentence-separation rules above.`;

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
