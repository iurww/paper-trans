import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionFromTag } from './release-version.mjs';

export async function createUpdaterManifest({ assets, repository, release }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const version = versionFromTag(release.tagName);
  const files = await readdir(assets);
  const platforms = {};
  for (const [target, suffix] of [['linux-x86_64-appimage', '.AppImage'], ['linux-x86_64-deb', '.deb'], ['darwin-aarch64', '.app.tar.gz']]) {
    const matches = files.filter(name => name.endsWith(suffix));
    if (matches.length !== 1) throw new Error(`Expected one ${suffix} update artifact`);
    const name = matches[0];
    const signature = (await readFile(resolve(assets, `${name}.sig`), 'utf8')).trim();
    if (!signature) throw new Error(`Missing signature for ${name}`);
    platforms[target] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${encodeURIComponent(release.tagName)}/${encodeURIComponent(name)}`,
    };
  }
  platforms['linux-x86_64'] = platforms['linux-x86_64-appimage'];
  const date = release.publishedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(date))) throw new Error('Invalid publish date');
  return { version, notes: release.body || release.name || `PaperLens ${version}`, pub_date: date, platforms };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [assets, repository, releaseFile] = process.argv.slice(2);
  const manifest = await createUpdaterManifest({ assets, repository, release: JSON.parse(await readFile(releaseFile, 'utf8')) });
  await writeFile(resolve(assets, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
