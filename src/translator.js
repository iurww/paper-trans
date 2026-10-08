import { getDocument, listDocuments, putDocument } from './storage.js';
import { exportPdf, readPdf } from './pdf.js';
import { RetryableTranslationError, TranslationConfigurationError, translateBatch } from './translation-api.js';

export const MAX_PENDING = 3;
let running = false;
const listeners = new Set();
let retryTimer;

export function subscribeChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function save(record) {
  await putDocument(record);
  for (const listener of listeners) listener(record);
}

function batches(lines, limit = 800) {
  const result = [];
  let batch = [], length = 0;
  for (const line of lines) {
    if (batch.length && (length + line.source.length > limit || batch.length >= 8)) {
      result.push(batch); batch = []; length = 0;
    }
    batch.push(line); length += line.source.length;
  }
  if (batch.length) result.push(batch);
  return result;
}

async function process(record, settings) {
  try {
    record.tokens ||= { prompt: 0, completion: 0, total: 0 };
    record.status = 'extracting'; record.progress = Math.max(record.progress, 2); record.error = '';
    await save(record);
    if (!record.pages?.every(page => Array.isArray(page.blocks))) {
      record.pages = await readPdf(new Uint8Array(await record.original.arrayBuffer()));
    }
    const all = record.pages.flatMap(page => page.blocks.flatMap(block => block.sentences));
    if (!all.length) throw new Error('没有找到可翻译正文；扫描版 PDF 需要先做 OCR。');
    record.status = 'translating';
    const remaining = batches(all.filter(line => !line.translation));
    await save(record);
    for (const group of remaining) {
      await translateBatch(group, settings, async usage => {
        record.tokens.prompt += usage.prompt_tokens || 0;
        record.tokens.completion += usage.completion_tokens || 0;
        record.tokens.total += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
        record.progress = 5 + Math.floor(82 * all.filter(line => line.translation).length / all.length);
        await save(record);
      });
    }
    record.status = 'typesetting'; record.progress = 90;
    await save(record);
    const output = await exportPdf(new Uint8Array(await record.original.arrayBuffer()), record.pages);
    record.translated = new Blob([output.bytes], { type: 'application/pdf' });
    record.warnings = output.warnings;
    record.status = 'done'; record.progress = 100; record.retryCount = 0; record.retryAt = 0;
    await save(record);
  } catch (error) {
    if (error instanceof RetryableTranslationError) {
      record.status = 'retrying';
      record.retryCount = (record.retryCount || 0) + 1;
      record.retryAt = Date.now() + Math.min(5000 * 3 ** (record.retryCount - 1), 180000);
    } else {
      record.status = 'error';
      record.errorKind = error instanceof TranslationConfigurationError ? 'configuration' : 'document';
    }
    record.error = error.message || String(error);
    await save(record);
  }
}

function scheduleRetry(settings, records) {
  clearTimeout(retryTimer);
  const next = records.filter(item => item.status === 'retrying').reduce((soonest, item) => Math.min(soonest, item.retryAt || Date.now()), Infinity);
  if (Number.isFinite(next)) retryTimer = setTimeout(() => runQueue(settings), Math.max(100, next - Date.now()));
}

export async function runQueue(settings) {
  if (running || !settings.key) return;
  clearTimeout(retryTimer);
  running = true;
  try {
    for (;;) {
      const records = await listDocuments();
      const legacyFailure = records.find(item => item.status === 'error' && /^翻译 API 缺少 .+ 的译文$|^翻译 API 未返回 lines 数组$/.test(item.error || ''));
      if (legacyFailure) {
        legacyFailure.status = 'queued'; legacyFailure.error = '';
        await save(legacyFailure);
        continue;
      }
      const next = records.reverse().find(item => ['queued', 'extracting', 'translating', 'typesetting'].includes(item.status) || item.status === 'retrying' && (item.retryAt || 0) <= Date.now());
      if (!next) { scheduleRetry(settings, records); break; }
      await process(next, settings);
      if (next.status === 'error' && next.errorKind === 'configuration') break;
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

export async function resumeConfigurationErrors(settings) {
  for (const record of await listDocuments()) {
    if (record.status === 'error' && record.errorKind === 'configuration') {
      record.status = 'queued'; record.error = '';
      await save(record);
    }
  }
  runQueue(settings);
}
