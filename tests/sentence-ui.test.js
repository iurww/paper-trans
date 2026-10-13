import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { validateAlignment, highlightRanges } from '../src/alignment/sentence-alignment.js';

function elements(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  const children = React.Children.toArray(tree.props?.children).flatMap(child => elements(child, predicate));
  return predicate(tree) ? [tree, ...children] : children;
}

test('sentence hover targets preserve emphasis across boundaries, inline math and exact displayed characters', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: LatexText } = await vite.ssrLoadModule('/src/reader/LatexText.jsx');
    const cases = [
      { original: '**First sentence. Second sentence.**', segments: ['**First sentence. ', 'Second sentence.**'], emphasis: 'strong' },
      { original: '\\textit{First sentence. Second sentence.}', segments: ['\\textit{First sentence. ', 'Second sentence.}'], emphasis: 'em' },
      { original: 'First *sentence* $x^2$. Second sentence.', segments: ['First *sentence* $x^2$. ', 'Second sentence.'], emphasis: 'em', math: true },
      { original: '\\textbf{First \\textit{sentence}. Second sentence.}', segments: ['\\textbf{First \\textit{sentence}. ', 'Second sentence.}'], emphasis: 'strong' },
    ];
    for (const { original, segments, emphasis, math } of cases) {
      const alignment = validateAlignment({ paragraphs: [{ paragraph: 0, original: segments, chinese: ['第一句。', '第二句。'],
        links: [{ original: [0], chinese: [0] }, { original: [1], chinese: [1] }] }] },
      [{ paragraph: 0, original, chinese: '第一句。第二句。' }], 1);
      assert.ok(alignment, original);
      const hovered = [];
      const tree = LatexText({ text: original, ranges: highlightRanges(alignment, 0, 'original'), onSentenceHover: id => hovered.push(id) });
      const spans = elements(tree, node => Boolean(node.props?.['data-sentence']));
      assert.ok(spans.some(span => span.props['data-sentence'] === 'p1-b0-s0'));
      assert.ok(spans.some(span => span.props['data-sentence'] === 'p1-b0-s1'));
      spans[0].props.onPointerEnter(); assert.equal(hovered.at(-1), 'p1-b0-s0');
      spans[0].props.onPointerLeave({ relatedTarget: null }); assert.equal(hovered.at(-1), null);
      const second = spans.find(span => span.props['data-sentence'] === 'p1-b0-s1');
      second.props.onPointerEnter(); assert.equal(hovered.at(-1), 'p1-b0-s1');
      second.props.onFocus(); assert.equal(hovered.at(-1), 'p1-b0-s1');
      const baseline = renderToString(React.createElement(LatexText, { text: original }));
      const rendered = renderToString(tree);
      const flatten = html => html.replace(/<[^>]*>/g, '');
      assert.equal(flatten(rendered), flatten(baseline), original);
      assert.ok(elements(tree, node => node.type === emphasis).length > 0);
      assert.doesNotMatch(rendered, /[\uE000-\uE003]/);
      if (math) {
        const formula = spans.find(span => span.props.className.includes('latex-inline'));
        assert.equal(formula.props['data-sentence'], 'p1-b0-s0');
        assert.match(rendered, /class="katex"/);
      }
      const chineseTree = LatexText({ text: '第一句。第二句。', ranges: highlightRanges(alignment, 0, 'chinese'), onSentenceHover: id => hovered.push(id) });
      const chineseSpans = elements(chineseTree, node => Boolean(node.props?.['data-sentence']));
      assert.equal(chineseSpans[1].props.children, '第二句。');
      chineseSpans[1].props.onPointerEnter(); assert.equal(hovered.at(-1), 'p1-b0-s1');
    }
  } finally { await vite.close(); }
});
