import test from 'node:test';
import assert from 'node:assert/strict';
import { omitVisualItem, visibleVisualPages } from '../src/translation/visual-content.js';

test('existing visual results retain references but hide tables and printed page numbers', () => {
  assert.equal(omitVisualItem({ kind: 'reference', original: 'Rafailov et al. 2023' }), false);
  assert.equal(omitVisualItem({ kind: 'paragraph', original: '[12] Rafailov et al. 2023' }), false);
  assert.equal(omitVisualItem({ kind: 'heading', original: 'References' }), false);
  assert.equal(omitVisualItem({ kind: 'table', original: 'Long cell text' }), true);
  assert.equal(omitVisualItem({ kind: 'author', original: 'Rafael Rafailov' }), false);
  assert.equal(omitVisualItem({ kind: 'affiliation', original: 'Stanford University' }), false);
  assert.equal(omitVisualItem({ kind: 'contact', original: 'author@stanford.edu' }), false);
  assert.equal(omitVisualItem({ kind: 'paragraph', original: '22' }), true);
  assert.equal(omitVisualItem({ kind: 'caption', original: 'Table 2: Results' }), false);
  assert.equal(omitVisualItem({ kind: 'paragraph', original: 'Theorem 1 Restated.' }), false);
});

test('cached first-page author and affiliation paragraphs remain visible as original only', () => {
  const pages = [{ paragraphs: [
    { kind: 'title', original: 'Direct Preference Optimization' },
    { kind: 'paragraph', original: 'Rafael Rafailov∗† Archit Sharma∗† Eric Mitchell∗†' },
    { kind: 'paragraph', original: 'Stanford University · CZ Biohub' },
    { kind: 'paragraph', original: 'rafailov@stanford.edu' },
    { kind: 'heading', original: 'Abstract' },
    { kind: 'paragraph', original: 'A university model can be trained with preferences.' },
  ] }];
  assert.deepEqual(visibleVisualPages(pages)[0].map(item => item.original), [
    'Direct Preference Optimization', 'Rafael Rafailov∗† Archit Sharma∗† Eric Mitchell∗†',
    'Stanford University · CZ Biohub', 'rafailov@stanford.edu',
    'Abstract', 'A university model can be trained with preferences.',
  ]);
  assert.deepEqual(visibleVisualPages(pages)[0].map(item => Boolean(item.originalOnly)),
    [false, true, true, true, false, false]);
});

test('recognizes a cached author line containing LaTeX spacing', () => {
  const author = 'Stefano Ermon †‡ \\quad Christopher D. Manning † \\quad Chelsea Finn †';
  const pages = [{ paragraphs: [
    { kind: 'title', original: 'A Paper' },
    { kind: 'paragraph', original: author, chinese: author },
    { kind: 'heading', original: 'Abstract' },
  ] }];
  assert.equal(visibleVisualPages(pages)[0][1].originalOnly, true);
});

test('reference section stays visible as original only across pages until an appendix heading', () => {
  const pages = [
    { paragraphs: [
      { kind: 'heading', original: 'References' },
      { kind: 'paragraph', original: 'Rafailov, R. et al. 2023' },
    ] },
    { paragraphs: [
      { kind: 'paragraph', original: 'Conference proceedings, pages 1–5.' },
      { kind: 'heading', original: 'A Additional Proofs' },
      { kind: 'paragraph', original: 'We now prove the theorem.' },
    ] },
  ];
  const visible = visibleVisualPages(pages);
  assert.deepEqual(visible.map(page => page.map(item => item.original)),
    [['References', 'Rafailov, R. et al. 2023'],
      ['Conference proceedings, pages 1–5.', 'A Additional Proofs', 'We now prove the theorem.']]);
  assert.deepEqual(visible.map(page => page.map(item => Boolean(item.originalOnly))),
    [[true, true], [true, false, false]]);
});

test('cached numbered reference paragraphs retain only their original text', () => {
  const pages = [{ paragraphs: [
    { kind: 'paragraph', original: '[12] Rafailov et al. 2023', chinese: '[12] 拉法伊洛夫等，2023' },
  ] }];
  assert.equal(visibleVisualPages(pages)[0][0].originalOnly, true);
});
