import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUpdaterManifest } from '../tools/updater-manifest.mjs';

test('manifest chooses signed Mac, AppImage and Debian assets from one release', async t => {
  const assets = await mkdtemp(join(tmpdir(), 'paperlens-updates-'));
  t.after(() => rm(assets, { recursive: true, force: true }));
  for (const name of ['PaperLens arm64.app.tar.gz', 'PaperLens.AppImage', 'PaperLens.deb']) {
    await writeFile(join(assets, name), 'binary');
    await writeFile(join(assets, `${name}.sig`), 'signature');
  }
  const release = { tagName: 'v1.2', body: 'Fixes\nNew features', publishedAt: '2026-10-14T00:00:00Z' };
  const manifest = await createUpdaterManifest({ assets, repository: 'iurww/paper-trans', release });
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.notes, release.body);
  assert.match(manifest.platforms['darwin-aarch64'].url, /PaperLens%20arm64\.app\.tar\.gz$/);
  assert.match(manifest.platforms['linux-x86_64-deb'].url, /\.deb$/);
  assert.match(manifest.platforms['linux-x86_64-appimage'].url, /\.AppImage$/);
  await rm(join(assets, 'PaperLens.deb.sig'));
  await assert.rejects(createUpdaterManifest({ assets, repository: 'iurww/paper-trans', release }), /ENOENT/);
});
