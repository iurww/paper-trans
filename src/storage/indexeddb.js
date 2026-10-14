const DB_NAME = 'paperlens-local-v1';
const STORE = 'documents';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      const folders = db.createObjectStore('folders', { keyPath: 'id' });
      folders.put({ id: 'default', name: 'default' });
      const cursor = request.transaction.objectStore(STORE).openCursor();
      cursor.onsuccess = () => { const item = cursor.result; if (item) { item.update({ ...item.value, folderId: item.value.folderId || 'default' }); item.continue(); } };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, action, storeName = STORE) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getDocument = id => transaction('readonly', store => store.get(id));
export const putDocument = record => transaction('readwrite', store => store.put(record));
export async function updateDocument(id, transform) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let updated;
      const get = store.get(id);
      get.onsuccess = () => {
        if (!get.result) { tx.abort(); return; }
        updated = transform(get.result);
        store.put(updated);
      };
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('文献记录不存在'));
    });
  } finally { db.close(); }
}
export async function listDocuments() {
  const records = await transaction('readonly', store => store.getAll());
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export const deleteDocument = id => transaction('readwrite', store => store.delete(id));
export const listFolders = () => transaction('readonly', store => store.getAll(), 'folders');
export const putFolder = folder => transaction('readwrite', store => store.put(folder), 'folders');
export async function replaceDocument(oldId, record) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(oldId);
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
