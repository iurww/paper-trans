import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('obsolete PDF render work is cancelled and abort listeners are removed', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const { renderPage } = await vite.ssrLoadModule('/src/pdf/pdf.js');
    let renders = 0, cancellations = 0, rejectRender;
    const page = {
      getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
      render() {
        renders++;
        return {
          promise: new Promise((resolve, reject) => { rejectRender = reject; }),
          cancel() { cancellations++; rejectRender(new Error('cancelled')); },
        };
      },
    };
    const pdf = { getPage: async () => page };
    const canvas = { style: {}, getContext: () => ({}) };
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(renderPage(pdf, 1, canvas, 600, { signal: aborted.signal }), { name: 'AbortError' });
    assert.equal(renders, 0);
    const controller = new AbortController();
    const rendering = renderPage(pdf, 1, canvas, 600, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(rendering, /cancelled/);
    assert.equal(cancellations, 1);
    const completed = new AbortController();
    page.render = () => ({ promise: Promise.resolve(), cancel() { cancellations++; } });
    await renderPage(pdf, 1, canvas, 600, { signal: completed.signal });
    completed.abort();
    assert.equal(cancellations, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await vite.close();
  }
});
