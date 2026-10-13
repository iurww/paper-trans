import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfjsAssets } from '../tools/pdfjs-assets.js';

test('PDF.js decoders retain their names and bytes in dev and production', () => {
  const plugin = pdfjsAssets();
  plugin.configResolved({ base: '/reader/' });
  let middleware;
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  const assets = new Map();
  plugin.generateBundle.call({ emitFile(asset) { assets.set(asset.fileName, asset.source); } });
  for (const filename of ['jbig2.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'qcms_bg.wasm']) {
    let body;
    let type;
    middleware({ url: `/reader/pdfjs/wasm/${filename}?v=1` }, {
      setHeader(name, value) { if (name === 'Content-Type') type = value; },
      end(value) { body = value; },
    }, () => assert.fail(`Missing decoder: ${filename}`));
    assert.deepEqual(body, assets.get(`pdfjs/wasm/${filename}`));
    assert.equal(type, filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    if (filename.endsWith('.wasm')) assert.deepEqual([...body.subarray(0, 4)], [0, 97, 115, 109]);
  }
  assert.ok(assets.has('pdfjs/wasm/LICENSE_JBIG2'));
  let passed = false;
  middleware({ url: '/reader/pdfjs/wasm/../../package.json' }, {}, () => { passed = true; });
  assert.equal(passed, true);
});
