import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { listDocuments, listFolders, putFolder, putDocument, updateDocument, deleteDocument, replaceDocument } from '../src/storage/storage.js';

globalThis.indexedDB = indexedDB;

test('migrates old papers into default and persists folders, moves, replacement and deletion', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('paperlens-local-v1', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('documents', { keyPath: 'id' });
      store.put({ id: 'old', filename: 'old.pdf', createdAt: 1, translated: new Blob(['translation']) });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  assert.deepEqual(await listFolders(), [{ id: 'default', name: 'default' }]);
  const [old] = await listDocuments();
  assert.equal(old.folderId, 'default');
  assert.equal(await old.translated.text(), 'translation');
  await putFolder({ id: 'research', name: 'Research' });
  await updateDocument('old', record => ({ ...record, folderId: 'research' }));
  assert.equal((await listDocuments())[0].folderId, 'research');
  await replaceDocument('old', { id: 'new', filename: 'new.pdf', folderId: 'research', createdAt: 2 });
  assert.deepEqual((await listDocuments()).map(item => item.id), ['new']);
  await assert.rejects(updateDocument('old', record => ({ ...record, status: 'done' })), /不存在/);
  await deleteDocument('new');
  assert.deepEqual(await listDocuments(), []);
  assert.equal((await listFolders()).length, 2);
  await putDocument({ id: 'fresh', createdAt: 3, folderId: 'default' });
  assert.equal((await listDocuments())[0].id, 'fresh');
});
