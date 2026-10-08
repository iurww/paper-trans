import test from 'node:test';
import assert from 'node:assert/strict';
import { groupParagraphs, layoutParagraph } from '../src/paragraphs.js';

const line = (source, x0, y0, x1, y1, kind = 'prose') => ({ source, rect: [x0, y0, x1, y1], fontSize: 10, kind, translate: true });

test('groups source lines into a paragraph with sentence spans and original width', () => {
  const blocks = groupParagraphs([
    line('A trans-', 50, 100, 250, 110),
    line('lation sentence. Another sentence', 50, 112, 250, 122),
    line('continues here.', 50, 124, 155, 134),
    line('Other column text.', 320, 100, 560, 110),
  ], 600, 1);
  assert.equal(blocks.length, 2);
  const paragraph = blocks.find(block => block.rect[0] === 50);
  assert.deepEqual(paragraph.rect, [50, 100, 250, 134]);
  assert.equal(paragraph.source, 'A translation sentence. Another sentence continues here.');
  assert.equal(paragraph.sentences.length, 2);
  assert.equal(paragraph.sentences[0].source, 'A translation sentence.');
  assert.equal(paragraph.sentences[1].source, 'Another sentence continues here.');
  assert.equal(paragraph.sentences[1].source_rects.length, 2);
});

test('typesets sentences continuously across the paragraph width', () => {
  const block = { rect: [50, 100, 250, 150], fontSize: 10, sentences: [
    { translation: '第一句。' }, { translation: '第二句继续。' },
  ] };
  const font = { widthOfTextAtSize: (text, size) => [...text].length * size };
  const layout = layoutParagraph(block, font);
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].text, '第一句。第二句继续。');
  assert.equal(layout.rects.length, 2);
  assert.equal(layout.rects[0][0][0], 50);
  assert.equal(layout.rects[1][0][0], 90);
  assert.equal(layout.overflow, false);
});

test('starts a new paragraph on source indentation and keeps caption continuations together', () => {
  const blocks = groupParagraphs([
    line('A complete sentence.', 50, 100, 245, 110),
    line('A new paragraph begins.', 60, 112, 245, 122),
    line('Figure 2: A long caption line', 50, 150, 245, 160, 'caption'),
    line('continues on this line.', 50, 162, 190, 172),
  ], 600, 1);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].source, 'Figure 2: A long caption line continues on this line.');
});
