import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('legacy PDF.js loads and parses a PDF when older WebView runtime APIs are absent', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { PDFDocument } from 'pdf-lib';
    delete globalThis.Iterator;
    delete Promise.withResolvers;
    delete Promise.try;
    delete URL.parse;
    delete Map.prototype.getOrInsertComputed;
    delete Uint8Array.prototype.toBase64;
    await import('./src/platform/webview-compat.js');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const source = await PDFDocument.create();
    source.addPage();
    const task = pdfjs.getDocument({ data: await source.save() });
    try {
      const pdf = await task.promise;
      if (pdf.numPages !== 1) throw new Error('PDF page count mismatch');
    } finally { await task.destroy(); }
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
