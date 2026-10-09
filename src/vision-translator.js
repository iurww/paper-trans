import { getDocument, updateDocument } from './storage.js';
import { openPdf } from './pdf.js';
import { translateVisualPage } from './vision-api.js';
import { notifyChange } from './translator.js';
import { processVisualPages } from './visual-pages.js';

const running = new Set();

async function saveVisual(id, patch) {
  const record = await updateDocument(id, current => ({ ...current, ...patch }));
  notifyChange(record);
}

async function savePage(id, number, result, usage = {}, error = '') {
  const record = await updateDocument(id, current => {
    const visualPages = [...(current.visualPages || [])];
    const visualPageErrors = { ...(current.visualPageErrors || {}) };
    if (result) {
      visualPages[number - 1] = { number, paragraphs: result };
      delete visualPageErrors[number];
    } else visualPageErrors[number] = error;
    const previous = current.visualTokens || { prompt: 0, completion: 0, total: 0 };
    return { ...current, visualPages, visualPageErrors, visualActivePage: null,
      visualTokens: {
        prompt: previous.prompt + (usage.prompt_tokens || 0),
        completion: previous.completion + (usage.completion_tokens || 0),
        total: previous.total + (usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
      } };
  });
  notifyChange(record);
}

export async function getPdfPageInfo(blob) {
  const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      pages.push({ number, width, height });
    }
    return pages;
  } finally { await pdf.loadingTask.destroy(); }
}

async function screenshot(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2.5, 2200 / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, background: 'white' }).promise;
    return canvas.toDataURL('image/jpeg', .88);
  } finally { canvas.width = 0; canvas.height = 0; }
}

export async function runVisualTranslation(id, key, { retry = false, onlyPage = null, redoPage = false } = {}) {
  if (running.has(id)) return;
  running.add(id);
  let pdf;
  try {
    const initial = await getDocument(id);
    if (!initial?.original || initial.visualStatus === 'done' && !redoPage ||
      initial.visualStatus === 'error' && !retry || redoPage && (!Number.isInteger(onlyPage) || onlyPage < 1)) return;
    if (!key) {
      await saveVisual(id, { visualStatus: 'error', visualError: '请先在 API 设置中填写 DeepSeek API Key' });
      return;
    }
    await saveVisual(id, { visualStatus: 'working', visualError: '', visualActivePage: null });
    pdf = await openPdf(new Uint8Array(await initial.original.arrayBuffer()));
    await saveVisual(id, { visualPageCount: pdf.numPages });
    await processVisualPages(pdf.numPages, {
      onlyPage,
      hasResult: async number => !redoPage && Boolean((await getDocument(id))?.visualPages?.[number - 1]),
      onStart: number => saveVisual(id, { visualActivePage: number }),
      translate: async number => {
        const imageUrl = await screenshot(await pdf.getPage(number));
        return translateVisualPage(imageUrl, key);
      },
      onSuccess: (number, { paragraphs, usage }) => savePage(id, number, paragraphs, usage),
      onFailure: (number, error) => savePage(id, number, null, error.usage, error.message || String(error)),
    });
    const latest = await getDocument(id);
    const missing = Array.from({ length: pdf.numPages }, (_, index) => index + 1)
      .filter(number => !latest.visualPages?.[number - 1]);
    if (redoPage && latest.visualPageErrors?.[onlyPage] && !missing.length) {
      await saveVisual(id, { visualStatus: 'done', visualActivePage: null });
      return;
    }
    await saveVisual(id, missing.length ? {
      visualStatus: 'error', visualActivePage: null,
      visualError: `仍有 ${missing.length} 页未完成（第 ${missing.slice(0, 8).join('、')}${missing.length > 8 ? '…' : ''} 页），可重试失败页。`,
    } : { visualStatus: 'done', visualError: '', visualActivePage: null, visualPageErrors: {} });
  } catch (error) {
    await saveVisual(id, { visualStatus: 'error', visualActivePage: null, visualError: error.message || String(error) });
  } finally {
    if (pdf) await pdf.loadingTask.destroy().catch(() => {});
    running.delete(id);
  }
}
