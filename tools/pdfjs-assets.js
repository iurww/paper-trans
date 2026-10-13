import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(require.resolve('pdfjs-dist/package.json'));

// Keep every PDF.js resource under its original filename in every runtime.
// Missing CMaps or fallback fonts can silently drop text while images still render.
export function pdfjsAssets() {
  let base;
  const resources = ['wasm', 'cmaps', 'standard_fonts', 'iccs'].flatMap(directory =>
    readdirSync(join(pdfjsDirectory, directory)).map(filename => ({
      path: `pdfjs/${directory}/${filename}`,
      source: join(pdfjsDirectory, directory, filename),
    })));
  const byPath = new Map(resources.map(resource => [resource.path, resource]));
  return {
    name: 'pdfjs-resources',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (!path?.startsWith(base)) return next();
        const resource = byPath.get(path.slice(base.length));
        if (!resource) return next();
        res.setHeader('Content-Type', resource.path.endsWith('.wasm') ? 'application/wasm'
          : resource.path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(resource.source));
      });
    },
    generateBundle() {
      for (const resource of resources) {
        this.emitFile({ type: 'asset', fileName: resource.path,
          source: readFileSync(resource.source) });
      }
    },
  };
}
