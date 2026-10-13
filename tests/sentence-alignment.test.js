import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentInputs, validateAlignment, alignmentMatches, highlightRanges, exportAlignment, withParagraphFallback } from '../src/alignment/sentence-alignment.js';
import { highlightSentence } from '../src/reader/sentence-highlight.js';

const text = { paragraph: 0, original: 'Same. Same.', chinese: '相同。相同。' };
const mapped = () => ({ paragraphs: [{ paragraph: 0, original: ['Same. ', 'Same.'], chinese: ['相同。', '相同。'],
  links: [{ original: [0], chinese: [0] }, { original: [1], chinese: [1] }] }] });

test('exact ranges distinguish repeated sentences, reject changes and stale snapshots', () => {
  const alignment = validateAlignment(mapped(), [text], 3);
  assert.deepEqual(alignment.paragraphs[0].original, [[0, 5], [6, 11]]);
  assert.deepEqual(highlightRanges(alignment, 0, 'chinese'), [
    { id: 'p3-b0-s0', start: 0, end: 3 }, { id: 'p3-b0-s1', start: 3, end: 6 },
  ]);
  assert.equal(alignmentMatches(alignment, [text]), true);
  assert.equal(alignmentMatches(alignment, [{ ...text, chinese: '改变。' }]), false);
  const wrong = mapped(); wrong.paragraphs[0].original[0] = 'Edited. ';
  assert.equal(validateAlignment(wrong, [text], 3), null);
  const incomplete = mapped(); incomplete.paragraphs[0].links.pop();
  assert.equal(validateAlignment(incomplete, [text], 3), null);
  const duplicate = mapped(); duplicate.paragraphs[0].links[1].original = [0];
  assert.equal(validateAlignment(duplicate, [text], 3), null);
  const extra = mapped(); extra.paragraphs.push(extra.paragraphs[0]);
  assert.equal(validateAlignment(extra, [text], 3), null);
});

test('supports reordered and merged/split translations without positional guessing', () => {
  const parsed = mapped();
  parsed.paragraphs[0].links = [{ original: [0], chinese: [1] }, { original: [1], chinese: [0] }];
  const result = validateAlignment(parsed, [text], 1);
  assert.equal(highlightRanges(result, 0, 'chinese')[0].id, 'p1-b0-s1');
  parsed.paragraphs[0].links = [{ original: [0, 1], chinese: [0, 1] }];
  assert.equal(validateAlignment(parsed, [text], 1).paragraphs[0].links.length, 1);
  parsed.paragraphs[0].chinese = ['相同。相同。'];
  parsed.paragraphs[0].links = [{ original: [0, 1], chinese: [0] }];
  assert.equal(validateAlignment(parsed, [text], 1).paragraphs[0].chinese.length, 1);
});

test('rejects boundaries inside formulae, markup delimiters and Unicode graphemes', () => {
  for (const [original, sentences] of [
    ['Use $x.y$. Done.', ['Use $x.', 'y$. Done.']],
    ['**One. Two.**', ['*', '*One. Two.**']],
    ['Use \\textit{one}.', ['Use \\text', 'it{one}.']],
    ['😀 Done.', ['\ud83d', '\ude00 Done.']],
    ['a\u0301. Done.', ['a', '\u0301. Done.']],
  ]) {
    assert.equal(validateAlignment({ paragraphs: [{ paragraph: 0, original: sentences, chinese: ['译文。'],
      links: [{ original: sentences.map((_, i) => i), chinese: [0] }] }] },
    [{ paragraph: 0, original, chinese: '译文。' }], 1), null, original);
  }
  const original = '**One. Two.**';
  const valid = { paragraphs: [{ paragraph: 0, original: ['**One. ', 'Two.**'], chinese: ['一。', '二。'],
    links: [{ original: [0], chinese: [0] }, { original: [1], chinese: [1] }] }] };
  assert.ok(validateAlignment(valid, [{ paragraph: 0, original, chinese: '一。二。' }], 1));
});

test('aligns displayed text after filtering and formula normalization, exports only current pages', () => {
  const pages = [{ number: 1, paragraphs: [
    { kind: 'author', original: 'An Author', chinese: '' },
    { kind: 'paragraph', original: 'Same. Same.', chinese: '相同。相同。' },
    { kind: 'paragraph', original: 'Math. $$x=1$$', chinese: '公式。 $$x=1$$' },
  ] }];
  const inputs = alignmentInputs(pages);
  assert.equal(inputs[0][0].paragraph, 1);
  assert.equal(inputs[0][1].chinese, '公式。');
  const parsed = mapped(); parsed.paragraphs[0].paragraph = 1;
  const alignment = validateAlignment(parsed, inputs[0].slice(0, 1), 1);
  assert.equal(exportAlignment([{ number: 1, paragraphs: pages[0].paragraphs.slice(0, 2) }], [alignment]).pages.length, 1);
  assert.equal(exportAlignment(pages, [alignment]).pages.length, 0);
});

test('bidirectional highlighting marks exactly the matching sentence group across both languages', () => {
  const nodes = ['p1-b0-s0', 'p1-b0-s1', 'p1-b0-s0', 'p1-b0-s1', 'p2-b0-s0'].map(id => ({
    dataset: { sentence: id }, active: false, classList: { toggle(_name, active) { this.owner.active = active; } },
  }));
  nodes.forEach(node => { node.classList.owner = node; });
  const root = { querySelectorAll: () => nodes };
  highlightSentence(root, nodes[0].dataset.sentence);
  assert.deepEqual(nodes.map(node => node.active), [true, false, true, false, false]);
  highlightSentence(root, nodes[3].dataset.sentence);
  assert.deepEqual(nodes.map(node => node.active), [false, true, false, true, false]);
  highlightSentence(root, null);
  assert.ok(nodes.every(node => !node.active));
});

test('paragraph fallback preserves precise entries and copies full saved text ranges without changing content', () => {
  const input = [text, { ...text, paragraph: 1, original: '  **One. Two.**\n', chinese: '  一。二。\n' }];
  const partial = { ...validateAlignment(mapped(), [text], 1), input };
  const complete = withParagraphFallback(partial, input, 1);
  assert.deepEqual(complete.paragraphs[0], partial.paragraphs[0]);
  assert.equal(complete.paragraphs[1].granularity, 'paragraph');
  assert.deepEqual(complete.paragraphs[1].original, [[0, input[1].original.length]]);
  assert.deepEqual(complete.paragraphs[1].chinese, [[0, input[1].chinese.length]]);
  assert.equal(highlightRanges(complete, 1, 'original')[0].id, highlightRanges(complete, 1, 'chinese')[0].id);
  assert.equal(alignmentMatches(complete, input), true);
  assert.deepEqual(complete.input, input);
});

test('original-only pages export complete local mappings without model requests', () => {
  const pages = [{ number: 1, paragraphs: [{ kind: 'reference', original: 'A reference', chinese: '' }] },
    { number: 2, paragraphs: [] }];
  for (const input of alignmentInputs(pages)) assert.equal(alignmentMatches(null, input), true);
  assert.ok(exportAlignment(pages).pages.every(page => page.complete && !page.paragraphs.length));
});
