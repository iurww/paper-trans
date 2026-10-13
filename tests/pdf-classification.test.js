import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('reference filtering continues across pages but stops at an appendix heading', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { classifyLines } = await vite.ssrLoadModule('/src/pdf/pdf.js');
    const line = source => ({ source, rect: [60, 100, 500, 115], fontSize: 14, items: [{ str: source, fontName: 'Times' }] });
    const state = { references: false };
    const before = classifyLines([line('An ordinary body paragraph describes the method.')], 600, state, 1);
    assert.equal(before[0].translate, true);
    const references = classifyLines([line('References'), line('Smith and Jones. A reference entry.')], 600, state, 2);
    assert.ok(references.every(item => item.kind === 'reference' && !item.translate));
    const continued = classifyLines([line('Another reference entry on the following page.')], 600, state, 3);
    assert.equal(continued[0].translate, false);
    for (const heading of ['Appendix A. Neural Net Architecture', 'Appendices', '附录 A 方法说明']) {
      state.references = true;
      const appendix = classifyLines([line(heading), line('In this appendix, we describe the architecture in detail.')], 600, state, 4);
      assert.equal(appendix[1].translate, true, heading);
      assert.equal(appendix[1].kind, 'prose', heading);
    }
    const laterReferences = classifyLines([line('Bibliography')], 600, state, 5);
    assert.equal(laterReferences[0].kind, 'reference');
  } finally { await vite.close(); }
});
