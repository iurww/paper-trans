import { isDesktop } from '../platform/desktop.js';
let desktop;
async function backend() {
  if (!isDesktop()) return import('./indexeddb.js');
  desktop ||= import('./filesystem.js').then(async ({ createFilesystemStorage }) => {
    const [fs, path] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/path')]);
    return createFilesystemStorage(fs, path, await path.join(await path.homeDir(), 'Documents', 'PaperLens'));
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
