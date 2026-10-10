import test from 'node:test';
import assert from 'node:assert/strict';
import { processVisualPages } from '../src/visual-pages.js';

test('malformed pages do not cancel the other in-flight pages, and retry skips saved pages', async () => {
  const completed = new Set([1]);
  const failed = [];
  const processed = [];
  let active = 0;
  let maxActive = 0;
  let release;
  const opened = new Promise(resolve => { release = resolve; });
  const options = {
    hasResult: async page => completed.has(page),
    onStart: async () => {},
    translate: async page => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 3) release();
      await opened;
      active -= 1;
      processed.push(page);
      if (page === 2 && failed.length === 0) throw new Error('JSON 不完整');
      return { paragraphs: [{ original: `${page}`, chinese: `${page}` }] };
    },
    onSuccess: async page => { completed.add(page); },
    onFailure: async page => { failed.push(page); },
  };
  await processVisualPages(4, options);
  assert.equal(maxActive, 3);
  assert.deepEqual(processed.sort((a, b) => a - b), [2, 3, 4]);
  assert.deepEqual(failed, [2]);
  assert.deepEqual([...completed].sort((a, b) => a - b), [1, 3, 4]);
  maxActive = 0;
  await processVisualPages(4, { ...options, onlyPage: 2 });
  assert.equal(maxActive, 1);
  assert.deepEqual(processed.sort((a, b) => a - b), [2, 2, 3, 4]);
  assert.deepEqual([...completed].sort((a, b) => a - b), [1, 2, 3, 4]);
});
