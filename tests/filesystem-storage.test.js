import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFilesystemStorage } from '../src/storage/filesystem.js';

async function fixture(t) {
  const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'paperlens-storage-'));
  t.after(() => nodeFs.rm(root, { recursive: true, force: true }));
  const fs = {
    mkdir: nodeFs.mkdir, readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, rename: nodeFs.rename,
    remove: (file, options) => nodeFs.rm(file, options),
    exists: async file => { try { await nodeFs.access(file); return true; } catch { return false; } },
    readDir: async dir => (await nodeFs.readdir(dir, { withFileTypes: true })).map(item => ({ name: item.name, isDirectory: item.isDirectory() })),
  };
  return { root, storage: createFilesystemStorage(fs, path, root), fs };
}
const paper = id => ({ id, filename: '论文.pdf', folderId: 'default', createdAt: 1, original: new Blob(['source']), translated: null, metadata: { title: '论文' }, visualPages: [{ paragraphs: ['译文'] }] });

test('filesystem roundtrip, concurrent updates, move, restart, replace and delete', async t => {
  const { root, storage, fs } = await fixture(t);
  await storage.putDocument(paper('one'));
  await storage.putDocument(paper('two'));
  assert.equal((await storage.listDocuments()).length, 2);
  const dir = path.join(root, 'default', '论文--one');
  assert.equal(await nodeFs.readFile(path.join(dir, 'original.pdf'), 'utf8'), 'source');
  assert.deepEqual(JSON.parse(await nodeFs.readFile(path.join(dir, 'translation.json'))).visualPages, paper('one').visualPages);
  await Promise.all(Array.from({ length: 5 }, () => storage.updateDocument('one', record => ({ ...record, count: (record.count || 0) + 1 }))));
  assert.equal((await storage.getDocument('one')).count, 5);
  await storage.putFolder({ id: 'research', name: '研究' });
  await storage.updateDocument('one', record => ({ ...record, folderId: 'research', translated: new Blob(['translated']) }));
  assert.equal(await fs.exists(dir), false);
  const reopened = createFilesystemStorage(fs, path, root);
  const saved = await reopened.getDocument('one');
  assert.equal(saved.folderId, 'research');
  assert.equal(await saved.original.text(), 'source');
  assert.equal(await saved.translated.text(), 'translated');
  await storage.replaceDocument('one', paper('replacement'));
  assert.equal(await storage.getDocument('one'), undefined);
  await storage.deleteDocument('replacement');
  await assert.rejects(storage.updateDocument('replacement', record => record), /不存在/);
  assert.equal((await storage.listDocuments()).length, 1);
  await assert.rejects(storage.putFolder({ id: 'bad', name: '..' }), /无效/);
  await assert.rejects(storage.putFolder({ id: 'bad', name: '../escape' }), /无效/);
});

test('migration is retryable, keeps existing translations and does not resurrect deleted records', async t => {
  const { storage } = await fixture(t);
  let fail = true;
  const legacy = {
    listFolders: async () => [{ id: 'default', name: 'default' }],
    listDocuments: async () => { if (fail) throw new Error('read failed'); return [paper('old')]; },
  };
  await assert.rejects(storage.migrate(legacy), /read failed/);
  fail = false;
  await storage.migrate(legacy);
  assert.equal(await (await storage.getDocument('old')).original.text(), 'source');
  await storage.updateDocument('old', record => ({ ...record, progress: 100 }));
  await storage.migrate(legacy);
  assert.equal((await storage.getDocument('old')).progress, 100);
  await storage.deleteDocument('old');
  await storage.migrate(legacy);
  assert.equal(await storage.getDocument('old'), undefined);
});

test('an interrupted JSON write preserves the committed translation snapshot', async t => {
  const { root, storage, fs } = await fixture(t);
  await storage.putDocument(paper('stable'));
  const write = fs.writeFile;
  fs.writeFile = async (file, data) => {
    if (file.endsWith('translation.json.tmp')) throw new Error('disk full');
    return write(file, data);
  };
  await assert.rejects(storage.updateDocument('stable', record => ({ ...record, progress: 90 })), /disk full/);
  fs.writeFile = write;
  const restarted = createFilesystemStorage(fs, path, root);
  assert.equal((await restarted.getDocument('stable')).progress, undefined);
  await restarted.updateDocument('stable', record => ({ ...record, progress: 100 }));
  assert.equal((await restarted.getDocument('stable')).progress, 100);
});

test('development and installed origins migrate independently into a shared library', async t => {
  const { storage } = await fixture(t);
  const previous = globalThis.location;
  t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
  const legacy = id => ({ listFolders: async () => [{ id: 'default', name: 'default' }], listDocuments: async () => [paper(id)] });
  globalThis.location = { origin: 'http://localhost:1420' };
  await storage.migrate(legacy('dev'));
  globalThis.location = { origin: 'tauri://localhost' };
  await storage.migrate(legacy('installed'));
  assert.deepEqual((await storage.listDocuments()).map(item => item.id).sort(), ['dev', 'installed']);
});
