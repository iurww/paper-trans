import test from 'node:test';
import assert from 'node:assert/strict';
import { displayParagraphText } from '../src/reader/visual-format.js';

test('keeps heading translation inline and shows standalone equations once', () => {
  assert.deepEqual(displayParagraphText({ kind: 'heading', original: '1. Introduction\n', chinese: '1. 引言\n' }),
    { original: '1. Introduction', chinese: '1. 引言' });
  assert.deepEqual(displayParagraphText({ kind: 'equation', original: '$$E=mc^2$$', chinese: '$$E=mc^2$$' }),
    { original: '$$E=mc^2$$', chinese: '' });
});

test('removes only display formulae repeated in a translated paragraph', () => {
  const value = displayParagraphText({ kind: 'paragraph',
    original: 'Energy follows $$E = mc^2$$ from the model.',
    chinese: '模型得到 $$E=mc^2$$，其中 $m$ 为质量。' });
  assert.equal(value.chinese, '模型得到，其中 $m$ 为质量。');
  const changed = displayParagraphText({ kind: 'paragraph', original: '$$x=1$$', chinese: '$$x=2$$' });
  assert.equal(changed.chinese, '$$x=2$$');
});

test('shows author metadata and identical cached text only once', () => {
  const author = 'Stefano Ermon †‡ \\quad Christopher D. Manning † \\quad Chelsea Finn †';
  assert.deepEqual(displayParagraphText({ kind: 'paragraph', original: author, chinese: author, originalOnly: true }),
    { original: author, chinese: '' });
  assert.deepEqual(displayParagraphText({ kind: 'paragraph', original: author, chinese: author }),
    { original: author, chinese: '' });
  assert.deepEqual(displayParagraphText({ kind: 'author', original: author, chinese: '作者译名' }),
    { original: author, chinese: '' });
  assert.deepEqual(displayParagraphText({ kind: 'affiliation', original: 'Stanford University', chinese: '斯坦福大学' }),
    { original: 'Stanford University', chinese: '' });
});

test('shows reference heading and entries in their original language only', () => {
  assert.deepEqual(displayParagraphText({ kind: 'heading', original: 'References', chinese: '参考文献', originalOnly: true }),
    { original: 'References', chinese: '' });
  assert.deepEqual(displayParagraphText({ kind: 'reference', original: '[1] Author, 2023.', chinese: '作者，2023。' }),
    { original: '[1] Author, 2023.', chinese: '' });
});
