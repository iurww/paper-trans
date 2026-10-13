import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synchronizeVersion, versionFromTag } from '../tools/release-version.mjs';

test('release tags accept two or three components and reject invalid versions', () => {
  assert.equal(versionFromTag('v0.2'), '0.2.0');
  assert.equal(versionFromTag('v1.12.3'), '1.12.3');
  for (const tag of [undefined, '', '1.2.3', 'v1', 'v01.2', 'v1.02.3', 'v1.2.03', 'v1.2.3.4', 'v1.2-beta', 'v1.2.3\n']) {
    assert.throws(() => versionFromTag(tag));
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'paperlens-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src-tauri'));
  const files = {
    'package.json': '{"name":"paperlens","version":"0.1.0"}',
    'package-lock.json': '{"version":"0.1.0","packages":{"":{"version":"0.1.0"},"node_modules/example":{"version":"4.0.0"}}}',
    'src-tauri/tauri.conf.json': '{"version":"0.1.0","identifier":"io.paperlens.desktop"}',
    'src-tauri/Cargo.toml': '[package]\nname = "paperlens"\nversion = "0.1.0"\n\n[dependencies]\nexample = "4.0.0"\n',
    'src-tauri/Cargo.lock': 'version = 4\n\n[[package]]\nname = "example"\nversion = "4.0.0"\n\n[[package]]\nname = "paperlens"\nversion = "0.1.0"\n',
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  return { root, files };
}

test('release version synchronizes every manifest without changing dependency versions', async t => {
  const { root } = await fixture(t);
  assert.equal(await synchronizeVersion('v2.3', root), '2.3.0');
  const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
  assert.equal((await json('package.json')).version, '2.3.0');
  const lock = await json('package-lock.json');
  assert.equal(lock.version, '2.3.0');
  assert.equal(lock.packages[''].version, '2.3.0');
  assert.equal(lock.packages['node_modules/example'].version, '4.0.0');
  assert.equal((await json('src-tauri/tauri.conf.json')).version, '2.3.0');
  const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  assert.match(cargo, /version = "2.3.0"/);
  assert.match(cargo, /example = "4.0.0"/);
  const cargoLock = await readFile(join(root, 'src-tauri/Cargo.lock'), 'utf8');
  assert.match(cargoLock, /name = "paperlens"\nversion = "2.3.0"/);
  assert.match(cargoLock, /name = "example"\nversion = "4.0.0"/);
  const first = await readFile(join(root, 'package.json'), 'utf8');
  await synchronizeVersion('v2.3', root);
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), first);
});

test('invalid tags and malformed manifests fail before any version files are written', async t => {
  const { root, files } = await fixture(t);
  await assert.rejects(synchronizeVersion('invalid', root));
  await writeFile(join(root, 'src-tauri/Cargo.lock'), 'invalid lock');
  await assert.rejects(synchronizeVersion('v2.3.4', root), /Cargo.lock/);
  for (const [path, content] of Object.entries(files)) {
    if (path !== 'src-tauri/Cargo.lock') assert.equal(await readFile(join(root, path), 'utf8'), content);
  }
});
