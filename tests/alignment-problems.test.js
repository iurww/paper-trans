import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentProblems, alignmentProblemMessage } from '../src/alignment-problems.js';
import { alignmentInputs, validateAlignment } from '../src/sentence-alignment.js';

test('missing pages and paragraphs are derived from current data even with a legacy generic error', () => {
  const text = { kind: 'paragraph', original: 'One.', chinese: '一句。' };
  const record = {
    visualPages: [null, { number: 2, paragraphs: [text, text] }, null,
      { number: 4, paragraphs: [{ kind: 'reference', original: 'Citation', chinese: '' }] },
      { number: 5, paragraphs: [text] }, { number: 6, paragraphs: [text] }],
    alignmentStatus: 'error', alignmentError: '仍有 2 个已翻译页面缺少有效句级对照',
    alignmentPageErrors: { 2: 'Missing indices', 5: 'Invalid JSON' },
  };
  const inputs = alignmentInputs(record.visualPages);
  const paragraph = index => ({ paragraph: index, original: ['One.'], chinese: ['一句。'],
    links: [{ original: [0], chinese: [0] }] });
  const partial = validateAlignment({ paragraphs: [paragraph(0), paragraph(1)] }, inputs[1], 2);
  partial.paragraphs.pop();
  record.sentenceAlignments = [null, partial, null, null, null,
    validateAlignment({ paragraphs: [paragraph(0)] }, inputs[5], 6)];
  const problems = alignmentProblems(record);
  assert.deepEqual(problems.map(page => page.number), [2, 5]);
  assert.deepEqual(problems[0].paragraphs.map(item => item.paragraph), [1]);
  assert.equal(problems[1].reason, 'Invalid JSON');
  assert.match(alignmentProblemMessage(problems), /PDF 第 2、5 页/);
  assert.equal(problems[0].paragraphs[0].original, text.original);
  assert.equal(problems[0].paragraphs[0].chinese, text.chinese);
  record.visualPages[1].paragraphs = [text, { ...text, chinese: '变化。' }];
  assert.equal(alignmentProblems(record)[0].paragraphs.length, 2);
});
