import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const wasmDirectory = join(dirname(require.resolve('pdfjs-dist/package.json')), 'wasm');

// PDF.js requests decoder files by their original names, including JS fallbacks.
// Keep them together under the same URL in dev, production and Capacitor builds.
export function pdfjsAssets() {
  let base;
  const filenames = readdirSync(wasmDirectory);
  return {
    name: 'pdfjs-decoder-assets',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const prefix = `${base}pdfjs/wasm/`;
        if (!path?.startsWith(prefix)) return next();
        const filename = path.slice(prefix.length);
        if (!filenames.includes(filename)) return next();
        res.setHeader('Content-Type', filename.endsWith('.wasm') ? 'application/wasm'
          : filename.endsWith('.js') ? 'text/javascript' : 'text/plain');
        res.end(readFileSync(join(wasmDirectory, filename)));
      });
    },
    generateBundle() {
      for (const filename of filenames) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/wasm/${filename}`,
          source: readFileSync(join(wasmDirectory, filename)) });
      }
    },
  };
}
