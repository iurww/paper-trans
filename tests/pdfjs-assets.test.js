import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfjsAssets } from '../tools/pdfjs-assets.js';

test('PDF.js decoders, CMaps, fonts and color profiles retain their bytes in dev and production', () => {
  const plugin = pdfjsAssets();
  plugin.configResolved({ base: '/reader/' });
  let middleware;
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  const assets = new Map();
  plugin.generateBundle.call({ emitFile(asset) { assets.set(asset.fileName, asset.source); } });
  for (const path of ['wasm/jbig2.wasm', 'wasm/jbig2_nowasm_fallback.js', 'wasm/openjpeg.wasm', 'wasm/openjpeg_nowasm_fallback.js', 'wasm/qcms_bg.wasm',
    'cmaps/UniGB-UCS2-H.bcmap', 'cmaps/UniJIS-UCS2-H.bcmap', 'standard_fonts/FoxitSerif.pfb', 'standard_fonts/FoxitSymbol.pfb',
    'standard_fonts/LiberationSans-Regular.ttf', 'iccs/CGATS001Compat-v2-micro.icc']) {
    let body;
    let type;
    middleware({ url: `/reader/pdfjs/${path}?v=1` }, {
      setHeader(name, value) { if (name === 'Content-Type') type = value; },
      end(value) { body = value; },
    }, () => assert.fail(`Missing PDF resource: ${path}`));
    assert.deepEqual(body, assets.get(`pdfjs/${path}`));
    assert.equal(type, path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    if (path.endsWith('.wasm')) assert.deepEqual([...body.subarray(0, 4)], [0, 97, 115, 109]);
  }
  assert.ok(assets.has('pdfjs/wasm/LICENSE_JBIG2'));
  let passed = false;
  middleware({ url: '/reader/pdfjs/wasm/../../package.json' }, {}, () => { passed = true; });
  assert.equal(passed, true);
});
