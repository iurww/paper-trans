// Dependencies are injected so checks and install/restart failures can be tested
// without replacing the running application.
export function createUpdateController({ check, environment, relaunch, beforeRestart = async () => {} }) {
  let state = { checking: false, update: null, error: '', message: '', installing: false, installed: false, progress: null, stage: '', canInstall: false, reason: '' };
  const listeners = new Set();
  let checking;
  let started = false;
  let manualRequested = false;
  const emit = patch => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  async function checkUpdates(manual = true) {
    if (state.installing || state.installed) return;
    manualRequested ||= manual;
    if (checking) return checking;
    emit({ checking: true, error: '', message: '' });
    checking = (async () => {
      try {
        const env = await environment();
        emit(env);
        const next = await check();
        if (state.update && state.update !== next) await state.update.close?.();
        emit({ update: next, message: next ? '' : manualRequested ? '当前已是最新版本' : '' });
      } catch (error) {
        if (manualRequested) emit({ error: `检查更新失败：${error.message || error}` });
      } finally {
        emit({ checking: false });
        manualRequested = false;
        checking = undefined;
      }
    })();
    return checking;
  }
  async function cancel() {
    if (state.installing) return;
    const update = state.update;
    emit({ update: null, error: '', stage: '', progress: null });
    await update?.close?.().catch(() => {});
  }
  async function restart() {
    await beforeRestart();
    await relaunch();
  }
  async function install() {
    if (!state.update || !state.canInstall || state.installing) return;
    emit({ installing: true, error: '', stage: state.installed ? '正在重启…' : '正在下载更新…', progress: null });
    try {
      if (!state.installed) {
        let downloaded = 0;
        let total = 0;
        await state.update.downloadAndInstall(event => {
          if (event.event === 'Started') { total = event.data.contentLength || 0; downloaded = 0; }
          if (event.event === 'Progress') downloaded += event.data.chunkLength;
          emit({ progress: total ? Math.min(100, Math.round(downloaded / total * 100)) : null,
            stage: event.event === 'Finished' ? '下载完成，正在验证并安装…' : '正在下载更新…' });
        }, { timeout: 120000 });
        emit({ installed: true, progress: 100, stage: '更新已安装，正在重启…' });
      }
      await restart();
    } catch (error) {
      emit({ error: `${state.installed ? '更新已安装，但重启失败' : '更新失败'}：${error.message || error}`, stage: '' });
    } finally {
      emit({ installing: false });
    }
  }
  return {
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    checkUpdates, install, cancel,
    start: () => { if (!started) { started = true; return checkUpdates(false); } },
  };
}
