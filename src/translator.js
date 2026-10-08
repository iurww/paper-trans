import { getDocument, listDocuments, putDocument } from './storage.js';
import { exportPdf, readPdf } from './pdf.js';

export const MAX_PENDING = 3;
let running = false;
let onChange = () => {};

export function setChangeListener(listener) { onChange = listener; }

async function save(record) {
  await putDocument(record);
  onChange(record);
}

async function translateBatch(lines, settings) {
  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Translate academic PDF text into Simplified Chinese. Return a JSON object {"lines":[{"id":"...","translation":"..."}]}. Preserve IDs and each line separately. Do not add commentary. Mathematical expressions, references, tables, and picture text are excluded by the application.' },
        { role: 'user', content: JSON.stringify({ lines: lines.map(({ id, source }) => ({ id, source })) }) },
      ],
    }),
  }).catch(() => { throw new Error('无法直连翻译 API。请检查网络，以及 API 是否允许浏览器跨域请求。'); });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`翻译 API 返回 ${response.status}: ${body.slice(0, 180)}`);
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  const results = JSON.parse(raw)?.lines;
  if (!Array.isArray(results)) throw new Error('翻译 API 未返回 lines 数组');
  const byId = new Map(results.map(item => [item.id, item.translation]));
  for (const line of lines) {
    const value = byId.get(line.id);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`翻译 API 缺少 ${line.id} 的译文`);
    line.translation = value.trim();
  }
  return data.usage || {};
}

function batches(lines, limit = 1800) {
  const result = [];
  let batch = [], length = 0;
  for (const line of lines) {
    if (batch.length && length + line.source.length > limit) {
      result.push(batch); batch = []; length = 0;
    }
    batch.push(line); length += line.source.length;
  }
  if (batch.length) result.push(batch);
  return result;
}

async function process(record, settings) {
  try {
    record.status = 'extracting'; record.progress = Math.max(record.progress, 2); record.error = '';
    await save(record);
    if (!record.pages) record.pages = await readPdf(new Uint8Array(await record.original.arrayBuffer()));
    const all = record.pages.flatMap(page => page.lines.filter(line => line.translate));
    if (!all.length) throw new Error('没有找到可翻译正文；扫描版 PDF 需要先做 OCR。');
    record.status = 'translating';
    const remaining = batches(all.filter(line => !line.translation));
    await save(record);
    for (const group of remaining) {
      const usage = await translateBatch(group, settings);
      record.tokens.prompt += usage.prompt_tokens || 0;
      record.tokens.completion += usage.completion_tokens || 0;
      record.tokens.total += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      record.progress = 5 + Math.floor(82 * all.filter(line => line.translation).length / all.length);
      await save(record);
    }
    record.status = 'typesetting'; record.progress = 90;
    await save(record);
    const output = await exportPdf(new Uint8Array(await record.original.arrayBuffer()), record.pages);
    record.translated = new Blob([output.bytes], { type: 'application/pdf' });
    record.warnings = output.warnings;
    record.status = 'done'; record.progress = 100;
    await save(record);
  } catch (error) {
    record.status = 'error'; record.error = error.message || String(error);
    await save(record);
  }
}

export async function runQueue(settings) {
  if (running || !settings.key) return;
  running = true;
  try {
    for (;;) {
      const next = (await listDocuments()).reverse().find(item => item.status === 'queued' || item.status === 'extracting' || item.status === 'translating' || item.status === 'typesetting');
      if (!next) break;
      await process(next, settings);
    }
  } finally { running = false; }
}

export async function retryDocument(id, settings) {
  const record = await getDocument(id);
  if (!record) return;
  record.status = 'queued'; record.error = '';
  await save(record);
  runQueue(settings);
}
