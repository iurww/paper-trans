import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateController } from '../src/app/update-controller.js';

const env = async () => ({ canInstall: true, reason: '' });
const noop = async () => {};

test('startup checks once and shares in-flight checks with manual requests', async () => {
  let calls = 0;
  let resolve;
  const gate = new Promise(done => { resolve = done; });
  const controller = createUpdateController({ environment: env, check: async () => { calls++; await gate; return null; }, relaunch: noop });
  const start = controller.start();
  controller.start();
  const manual = controller.checkUpdates();
  resolve();
  await Promise.all([start, manual]);
  assert.equal(calls, 1);
  assert.equal(controller.getState().message, '当前已是最新版本');
  assert.equal(controller.getState().checking, false);
});

test('cancel closes the update resource without downloading it', async () => {
  let closed = 0;
  const update = { version: '1.0.0', close: async () => { closed++; } };
  const controller = createUpdateController({ environment: env, check: async () => update, relaunch: noop });
  await controller.start();
  assert.equal(controller.getState().update, update);
  await controller.cancel();
  assert.equal(closed, 1);
  assert.equal(controller.getState().update, null);
});

test('install tracks progress and flushes saved papers before restarting; restart can be retried', async () => {
  const sequence = [];
  let installs = 0;
  let restarts = 0;
  const update = { downloadAndInstall: async callback => {
    installs++;
    callback({ event: 'Started', data: { contentLength: 100 } });
    callback({ event: 'Progress', data: { chunkLength: 50 } });
    assert.equal(controller.getState().progress, 50);
    callback({ event: 'Finished' });
    sequence.push('install');
  } };
  const controller = createUpdateController({ environment: env, check: async () => update,
    beforeRestart: async () => { sequence.push('flush'); },
    relaunch: async () => { sequence.push('restart'); if (++restarts === 1) throw new Error('restart failed'); },
  });
  await controller.start();
  await controller.install();
  assert.equal(controller.getState().installed, true);
  assert.match(controller.getState().error, /重启失败/);
  await controller.install();
  assert.equal(installs, 1);
  assert.deepEqual(sequence, ['install', 'flush', 'restart', 'flush', 'restart']);
  assert.equal(controller.getState().error, '');
});

test('download/signature errors do not restart and can be retried', async () => {
  let calls = 0;
  let restarts = 0;
  const update = { downloadAndInstall: async () => { if (++calls === 1) throw new Error('Invalid signature'); } };
  const controller = createUpdateController({ environment: env, check: async () => update, relaunch: async () => { restarts++; } });
  await controller.start();
  await controller.install();
  assert.equal(restarts, 0);
  assert.equal(controller.getState().installing, false);
  assert.equal(controller.getState().installed, false);
  assert.match(controller.getState().error, /Invalid signature/);
  await controller.install();
  assert.equal(restarts, 1);
});

test('automatic network errors are silent; manual failures are shown and retriable', async () => {
  let calls = 0;
  const controller = createUpdateController({ environment: env, check: async () => { if (++calls < 3) throw new Error('offline'); return null; }, relaunch: noop });
  await controller.start();
  assert.equal(controller.getState().error, '');
  await controller.checkUpdates();
  assert.match(controller.getState().error, /offline/);
  await controller.checkUpdates();
  assert.equal(controller.getState().error, '');
  assert.equal(controller.getState().message, '当前已是最新版本');
});

test('development mode can check but never replaces the running executable', async () => {
  const controller = createUpdateController({ environment: async () => ({ canInstall: false, reason: 'development' }),
    check: async () => ({ downloadAndInstall: async () => assert.fail('must not install') }), relaunch: noop });
  await controller.start();
  await controller.install();
  assert.equal(controller.getState().canInstall, false);
});
