import { useEffect, useState } from 'react';
import { isDesktop } from '../platform/desktop.js';
import { createUpdateController } from './update-controller.js';
import { flushStorage } from '../storage/storage.js';

const controller = createUpdateController({
  check: async () => (await import('@tauri-apps/plugin-updater')).check({ timeout: 15000 }),
  environment: async () => (await import('@tauri-apps/api/core')).invoke('update_environment'),
  relaunch: async () => (await import('@tauri-apps/plugin-process')).relaunch(),
  beforeRestart: flushStorage,
});

export function useAppUpdates() {
  const enabled = isDesktop();
  const [state, setState] = useState(controller.getState);
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = controller.subscribe(setState);
    setState(controller.getState());
    void controller.start();
    return unsubscribe;
  }, [enabled]);
  return { ...state, enabled, checkUpdates: controller.checkUpdates, install: controller.install, cancel: controller.cancel };
}
