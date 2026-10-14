import { Capacitor } from '@capacitor/core';

export const isAndroid = () => Capacitor.getPlatform() === 'android';

export function isDesktop() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export async function apiFetch(input, init) {
  if (isDesktop()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(input, init);
  }
  return globalThis.fetch(input, init);
}

export async function saveBlob(blob, filename) {
  if (isDesktop()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
    ]);
    const extension = filename.split('.').pop();
    const path = await save({ defaultPath: filename, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
