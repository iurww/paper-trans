import { parseContent, request, RetryableTranslationError, TranslationConfigurationError } from './translation-api.js';
import { isOriginalOnlyVisualItem, omitVisualItem } from './visual-content.js';

export const DEEPSEEK_VISION_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash';

const kinds = new Set(['title', 'heading', 'paragraph', 'equation', 'caption', 'list', 'table', 'footnote', 'reference', 'author', 'affiliation', 'contact']);
const prompt = `Read this complete academic PDF page visually and translate it into Simplified Chinese. Return ONLY a JSON object of this form:
{"paragraphs":[{"kind":"paragraph","original":"original-language text with LaTeX","chinese":"Chinese translation with LaTeX"}]}
Follow the page's reading order, including two-column layout. Keep visible prose paragraphs, headings, equations, and captions outside tables as separate items. CRITICAL: Do not transcribe, translate, summarize, or output ANY content inside a table, even when a cell contains long paragraphs of text. Skip table cells, row and column headers, and table numbers inside the grid. A table caption outside the grid may be translated. Include author names, author affiliations, institutions, postal addresses, and email/contact lines as separate items with kind author, affiliation, or contact; transcribe their original content exactly once in original and set chinese to an empty string. Include the References/Bibliography heading and every bibliography entry in reading order; use kind heading for the heading and kind reference for each entry, transcribe their original text, and set chinese to an empty string. Never translate author metadata or references. Skip standalone printed page numbers and running headers. Do not invent text. For each other included item, transcribe the actual original-language content from the image in original, then translate it in chinese. Preserve citations, numbering, symbols, and the logical paper structure. Preserve bold and italic emphasis with Markdown **bold** and *italic* markers in BOTH fields. The viewer renders math with KaTeX, so produce KaTeX-compatible LaTeX syntax only. Wrap EVERY inline formula in $...$ and EVERY displayed or numbered formula in $$...$$; a standalone displayed formula must be a separate item with kind equation, original containing the full $$...$$ formula and chinese set to an empty string. Put equation numbers inside the display math as \\tag{8}, for example $$f(x)=x^2 \\tag{8}$$. Never put \\tag outside $$...$$, never emit a bare LaTeX equation, and do not use full-LaTeX document commands or unsupported packages. Preserve the mathematical meaning, equation numbers, and variable names exactly; do not translate LaTeX commands. Use kind title, heading, paragraph, equation, caption, list, footnote, author, affiliation, contact or reference. A page containing only a table has an empty paragraphs array. Escape backslashes correctly in JSON.`;

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

async function requestVisual(imageUrl, key, promptText, maxTokens, fetchImpl, sleep) {
  const settings = { endpoint: DEEPSEEK_VISION_ENDPOINT, model: DEEPSEEK_VISION_MODEL, key,
    maxTokens, thinking: { type: 'disabled' }, timeoutMs: 240000 };
  return request([{ role: 'user', content: [
    { type: 'text', text: promptText },
    { type: 'image_url', image_url: { url: imageUrl, detail: 'original' } },
  ] }], settings, fetchImpl, sleep);
}

async function translateInChunks(imageUrl, key, usage, fetchImpl, sleep) {
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
      const data = await requestVisual(imageUrl, key, instruction, 12000, fetchImpl, sleep);
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

export async function translateVisualPage(imageUrl, key, { fetchImpl = fetch, sleep } = {}) {
  if (!key) throw new TranslationConfigurationError('请先在 API 设置中填写 DeepSeek API Key');
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await requestVisual(imageUrl, key, prompt, attempt ? 64000 : 32000, fetchImpl, sleep);
      addUsage(usage, data.usage);
      const paragraphs = parseVisualPage(data.choices?.[0]?.message?.content);
      if (paragraphs && data.choices?.[0]?.finish_reason !== 'length') return { paragraphs, usage };
      if (attempt === 0 && sleep) await sleep(500);
    }
    return { paragraphs: await translateInChunks(imageUrl, key, usage, fetchImpl, sleep), usage };
  } catch (error) {
    error.usage ||= usage;
    throw error;
  }
}
