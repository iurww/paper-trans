import { isDesktop } from '../platform/desktop.js';
import * as legacy from './indexeddb.js';
let desktop;
async function backend() {
  if (!isDesktop()) return legacy;
  desktop ||= import('./filesystem.js').then(async ({ createFilesystemStorage }) => {
    const [fs, path] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/path')]);
    const storage = createFilesystemStorage(fs, path, await path.join(await path.homeDir(), 'Documents', 'PaperLens'));
    await storage.migrate(legacy);
    return storage;
  }).catch(error => { desktop = undefined; throw error; });
  return desktop;
}
export const getDocument = async id => (await backend()).getDocument(id);
export const listDocuments = async () => (await backend()).listDocuments();
export const putDocument = async record => (await backend()).putDocument(record);
export const updateDocument = async (id, transform) => (await backend()).updateDocument(id, transform);
export const deleteDocument = async id => (await backend()).deleteDocument(id);
export const listFolders = async () => (await backend()).listFolders();
export const putFolder = async folder => (await backend()).putFolder(folder);
export const replaceDocument = async (id, record) => (await backend()).replaceDocument(id, record);
export const flushStorage = async () => (await backend()).flush?.();
