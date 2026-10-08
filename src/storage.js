const DB_NAME = 'paperlens-local-v1';
const STORE = 'documents';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getDocument = id => transaction('readonly', store => store.get(id));
export const putDocument = record => transaction('readwrite', store => store.put(record));
export async function listDocuments() {
  const records = await transaction('readonly', store => store.getAll());
  return records.sort((a, b) => b.createdAt - a.createdAt);
}
