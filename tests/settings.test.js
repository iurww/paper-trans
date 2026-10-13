import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../src/app/settings.js';

test('uses one key and migrates the legacy vision key when the common key is empty', () => {
  let stored = JSON.stringify({ key: '', visionKey: 'legacy-vision' });
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  assert.equal(loadSettings().key, 'legacy-vision');
  assert.equal(Object.hasOwn(loadSettings(), 'visionKey'), false);
  stored = JSON.stringify({ key: 'common', visionKey: 'legacy-vision' });
  assert.equal(loadSettings().key, 'common');
  saveSettings(loadSettings());
  assert.equal(Object.hasOwn(JSON.parse(stored), 'visionKey'), false);
  stored = '{}';
  assert.equal(loadSettings().key, '');
  delete globalThis.localStorage;
});

test('loads flash by default and replaces the old chat default while preserving custom models', () => {
  let stored = '{}';
  globalThis.localStorage = { getItem: () => stored };
  try {
    assert.equal(loadSettings().model, 'deepseek-flash');
    stored = JSON.stringify({ model: 'deepseek-chat', key: 'saved-key' });
    assert.equal(loadSettings().model, 'deepseek-flash');
    assert.equal(loadSettings().key, 'saved-key');
    stored = JSON.stringify({ model: '' });
    assert.equal(loadSettings().model, 'deepseek-flash');
    stored = JSON.stringify({ model: 'custom-model' });
    assert.equal(loadSettings().model, 'custom-model');
  } finally { delete globalThis.localStorage; }
});
