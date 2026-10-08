import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryableTranslationError, translateBatch } from '../src/translation-api.js';

const settings = { endpoint: 'https://example.test/chat/completions', model: 'test-model', key: 'test-key' };
const response = (content, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage }),
});

test('recovers a missing line automatically and saves partial progress', async () => {
  const lines = [33, 34, 35].map(number => ({ id: `p1l${number}`, source: `Source ${number}`, translation: '' }));
  const snapshots = [];
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (calls === 1) {
      assert.equal(JSON.parse(body.messages[1].content).lines.length, 3);
      return response(JSON.stringify({ lines: [
        { id: 'p1l33', translation: '译文 33' },
        { id: 'p1l35', translation: '译文 35' },
      ] }));
    }
    assert.equal(body.messages[1].content, 'Source 34');
    return response('{"translation":"译文 34"}');
  };
  await translateBatch(lines, settings, async usage => snapshots.push({ usage, translated: lines.filter(line => line.translation).length }), { fetchImpl, sleep: async () => {} });
  assert.deepEqual(lines.map(line => line.translation), ['译文 33', '译文 34', '译文 35']);
  assert.deepEqual(snapshots.map(item => item.translated), [2, 3]);
  assert.equal(snapshots.reduce((total, item) => total + item.usage.total_tokens, 0), 30);
  assert.equal(calls, 2);
});

test('splits malformed batch output into smaller automatic requests', async () => {
  const lines = [1, 2, 3, 4].map(number => ({ id: `p2l${number}`, source: `Text ${number}`, translation: '' }));
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (calls === 1) return response('invalid JSON');
    const requested = JSON.parse(body.messages[1].content).lines;
    return response(JSON.stringify({ lines: requested.map(line => ({ id: line.id, translation: `译${line.id}` })) }));
  };
  await translateBatch(lines, settings, async () => {}, { fetchImpl, sleep: async () => {} });
  assert.equal(calls, 3);
  assert.ok(lines.every(line => line.translation));
});

test('marks repeated single-line omissions as retryable', async () => {
  const line = { id: 'p1l34', source: 'Source', translation: '' };
  let calls = 0;
  await assert.rejects(
    translateBatch([line], settings, async () => {}, { fetchImpl: async () => { calls++; return response('{}'); }, sleep: async () => {} }),
    RetryableTranslationError,
  );
  assert.equal(calls, 3);
});

test('retries rate limits without asking for user action', async () => {
  const line = { id: 'p1l34', source: 'Source', translation: '' };
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => '1' }, text: async () => 'rate limit' };
    return response('{"translation":"译文"}');
  };
  await translateBatch([line], settings, async () => {}, { fetchImpl, sleep: async () => {} });
  assert.equal(line.translation, '译文');
  assert.equal(calls, 2);
});
