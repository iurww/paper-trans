import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPerformance } from '../tools/performance/check.mjs';

const good = () => [
  { type: 'scroll', p95ms: 20, maxMs: 39, framesOver50ms: 0, samples: 235, maxCanvases: 4, maxCanvasMiB: 17, errors: [] },
  ...['新建翻译', 'API 设置', '论文详情'].map(label => ({ type: 'modal', label,
    trials: Array.from({ length: 3 }, () => ({ firstPaintMs: 70, p95ms: 20, maxMs: 30 })) })),
  { type: 'done' },
];

test('desktop budget rejects the measured CI scroll and modal regression', () => {
  assert.deepEqual(checkPerformance(good()), []);
  const slow = good();
  Object.assign(slow[0], { p95ms: 128, maxMs: 408, framesOver50ms: 235 });
  slow[2].trials[0] = { firstPaintMs: 145, p95ms: 133, maxMs: 136 };
  const failures = checkPerformance(slow);
  assert.ok(failures.some(message => message.includes('Scroll P95')));
  assert.ok(failures.some(message => message.includes('API 设置: animation P95')));
});

test('incomplete, failed, or visually absent audits cannot pass', () => {
  assert.ok(checkPerformance([]).length);
  const missing = good(); missing.pop();
  assert.ok(checkPerformance(missing).length);
  const absent = good(); absent[1].trials[0].firstPaintMs = null;
  assert.ok(checkPerformance(absent).length);
  const errors = good(); errors[0].errors = ['PDF failed to render'];
  assert.ok(checkPerformance(errors).length);
  const memory = good(); memory[0].maxCanvasMiB = 800;
  assert.ok(checkPerformance(memory).length);
});
