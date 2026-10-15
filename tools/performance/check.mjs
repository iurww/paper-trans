import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkPerformance(records, profile = 'desktop') {
  if (!['desktop', 'software'].includes(profile)) throw new Error('Unknown performance profile');
  // Desktop is the release acceptance budget on a visible 60 Hz desktop.
  // Software is a CI smoke budget, not evidence of GPU/driver smoothness.
  const limits = profile === 'desktop'
    ? { scroll: 35, modal: 40, firstPaint: 160, maxFrame: 250 }
    : { scroll: 250, modal: 250, firstPaint: 1000, maxFrame: 1500 };
  const failures = [];
  if (!records.some(record => record.type === 'done')) failures.push('Audit did not complete');
  const scroll = records.filter(record => record.type === 'scroll');
  const modals = records.filter(record => record.type === 'modal');
  if (!scroll.length || modals.length < 3) failures.push('Missing scroll or modal measurements');
  for (const record of records) {
    if (record.type === 'error') failures.push(record.message);
    if (record.type === 'scroll') {
      if (!Number.isFinite(record.p95ms) || record.p95ms > limits.scroll) failures.push(`Scroll P95 ${record.p95ms} ms > ${limits.scroll}`);
      if (record.maxMs > limits.maxFrame) failures.push(`Scroll stall ${record.maxMs} ms`);
      if (record.samples < 200) failures.push('Too few scroll samples');
      if (record.maxCanvasMiB > 256 || record.maxCanvases > 12) failures.push('Unbounded canvas memory');
      if (record.errors?.length) failures.push(...record.errors);
      if (profile === 'desktop' && record.framesOver50ms / record.samples > .02) failures.push('More than 2% of scroll frames exceed 50 ms');
    }
    if (record.type === 'modal') {
      if (record.trials?.length !== 3) failures.push(`${record.label}: missing trials`);
      for (const trial of record.trials || []) {
        if (!Number.isFinite(trial.firstPaintMs) || trial.firstPaintMs > limits.firstPaint) failures.push(`${record.label}: first paint ${trial.firstPaintMs} ms`);
        if (!Number.isFinite(trial.p95ms) || trial.p95ms > limits.modal) failures.push(`${record.label}: animation P95 ${trial.p95ms} ms > ${limits.modal}`);
        if (trial.maxMs > limits.maxFrame) failures.push(`${record.label}: stall ${trial.maxMs} ms`);
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkPerformance(JSON.parse(await readFile(process.argv[2], 'utf8')), process.argv[3] || 'desktop');
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Performance budget passed');
}
