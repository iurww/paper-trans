import test from 'node:test';
import assert from 'node:assert/strict';
import { processVisualPages } from '../src/visual-pages.js';

test('one malformed page does not prevent later pages from completing, and retry skips saved pages', async () => {
  const completed = new Set([1]);
  const failed = [];
  const processed = [];
  const options = {
    hasResult: async page => completed.has(page),
    onStart: async () => {},
    translate: async page => {
      processed.push(page);
      if (page === 2 && failed.length === 0) throw new Error('JSON 不完整');
      return { paragraphs: [{ original: `${page}`, chinese: `${page}` }] };
    },
    onSuccess: async page => { completed.add(page); },
    onFailure: async page => { failed.push(page); },
  };
  await processVisualPages(4, options);
  assert.deepEqual(processed, [2, 3, 4]);
  assert.deepEqual(failed, [2]);
  assert.deepEqual([...completed], [1, 3, 4]);
  await processVisualPages(4, { ...options, onlyPage: 2 });
  assert.deepEqual(processed, [2, 3, 4, 2]);
  assert.deepEqual([...completed], [1, 3, 4, 2]);
});
