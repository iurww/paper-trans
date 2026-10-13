import { visibleVisualPages } from './visual-content.js';
import { displayParagraphText } from './reader/visual-format.js';
import { mathPattern, validRichTextBoundaries } from './rich-text.js';

export const ALIGNMENT_VERSION = 1;
export const ALIGNMENT_PROTOCOL = 2;

// Sentence text is always sliced from the saved source. The model only chooses
// correspondence IDs, so whitespace, escaping and formulae cannot be rewritten.
export function sentenceCandidates(text) {
  const tokens = [...text.matchAll(mathPattern)];
  let masked = text;
  for (const token of tokens.toReversed()) {
    masked = masked.slice(0, token.index) + 'M'.repeat(token[0].length) + masked.slice(token.index + token[0].length);
  }
  masked = masked.replace(/\\[A-Za-z]+\*?\{|\\[A-Za-z]+|[*_]+|[{}]/g, token => ' '.repeat(token.length));
  const ends = [];
  const abbreviation = /(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Fig|Figs|Eq|Eqs|No|Nos|Vol|pp|vs|al|etc|e\.g|i\.e)|\b[A-Z])\.[\s*_}]*$/i;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(masked)) {
    let end = part.index + part.segment.length;
    const inside = tokens.find(token => end > token.index && end < token.index + token[0].length);
    if (inside) end = inside.index + inside[0].length;
    const last = ends.at(-1) || 0;
    if (end <= last || abbreviation.test(text.slice(last, end)) && end < text.length) continue;
    if (validRichTextBoundaries(text, [end])) ends.push(end);
  }
  if (ends.at(-1) !== text.length) ends.push(text.length);
  let start = 0;
  const sentences = [];
  for (const end of ends) {
    const fragment = text.slice(start, end);
    if (!fragment.trim() && sentences.length) sentences[sentences.length - 1] += fragment;
    else sentences.push(fragment);
    start = end;
  }
  return sentences;
}

export function candidateInput(input) {
  return input.map(({ paragraph, original, chinese }) => ({ paragraph,
    original: sentenceCandidates(original), chinese: sentenceCandidates(chinese) }));
}

export function validateCandidateParagraph(item, basis, candidates, page) {
  // Accept older exact-string responses as well; never trust their copied text.
  if (Array.isArray(item?.original) && Array.isArray(item?.chinese)) {
    return validateAlignment({ paragraphs: [item] }, [basis], page)?.paragraphs[0] || null;
  }
  if (item?.paragraph !== basis.paragraph || !Array.isArray(item.links) || !item.links.length) return null;
  const counts = { original: candidates.original.length, chinese: candidates.chinese.length };
  const edges = [];
  for (const link of item.links) {
    const normalized = {};
    for (const side of ['original', 'chinese']) {
      const ids = Array.isArray(link?.[side]) ? link[side] : [link?.[side]];
      if (!ids.length) return null;
      normalized[side] = [...new Set(ids.map(id => typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id))];
      if (normalized[side].some(id => !Number.isInteger(id) || id < 0 || id >= counts[side])) return null;
    }
    edges.push(normalized);
  }
  // Repeated links for split translations describe a connected group. Merge
  // their shared IDs rather than rejecting an otherwise complete mapping.
  const groups = [];
  for (const edge of edges) {
    const group = { original: new Set(edge.original), chinese: new Set(edge.chinese) };
    for (let index = groups.length - 1; index >= 0; index--) {
      const previous = groups[index];
      if (['original', 'chinese'].some(side => [...previous[side]].some(id => group[side].has(id)))) {
        for (const side of ['original', 'chinese']) for (const id of previous[side]) group[side].add(id);
        groups.splice(index, 1);
      }
    }
    groups.push(group);
  }
  const links = groups.map(group => Object.fromEntries(['original', 'chinese'].map(side =>
    [side, [...group[side]].sort((a, b) => a - b)])));
  return validateAlignment({ paragraphs: [{ ...candidates, links }] }, [basis], page)?.paragraphs[0] || null;
}

// Use the same normalized, filtered text as the viewer, so offsets do not drift
// when duplicate display formulae or original-only metadata are hidden.
export function alignmentInputs(visualPages) {
  return visibleVisualPages(visualPages).map(paragraphs => paragraphs.flatMap((item, paragraph) => {
    const { original, chinese } = displayParagraphText(item);
    return chinese ? [{ paragraph, original, chinese }] : [];
  }));
}

function sentenceRanges(text, sentences) {
  if (!Array.isArray(sentences) || !sentences.length ||
      sentences.some(sentence => typeof sentence !== 'string' || !sentence.trim()) || sentences.join('') !== text) return null;
  let offset = 0;
  const ranges = sentences.map(sentence => {
    const start = offset + sentence.length - sentence.trimStart().length;
    offset += sentence.length;
    return [start, offset - (sentence.length - sentence.trimEnd().length)];
  });
  return validRichTextBoundaries(text, ranges.flat()) ? ranges : null;
}

export function validateAlignment(parsed, input, page) {
  if (!Array.isArray(parsed?.paragraphs) || parsed.paragraphs.length !== input.length) return null;
  const result = [];
  const seen = new Set();
  for (const item of parsed.paragraphs) {
    const basis = input.find(entry => entry.paragraph === item?.paragraph);
    if (!basis || seen.has(item.paragraph)) return null;
    seen.add(item.paragraph);
    const original = sentenceRanges(basis.original, item.original);
    const chinese = sentenceRanges(basis.chinese, item.chinese);
    if (!original || !chinese || !Array.isArray(item.links) || !item.links.length) return null;
    const used = { original: new Set(), chinese: new Set() };
    const links = [];
    for (const [index, link] of item.links.entries()) {
      for (const side of ['original', 'chinese']) {
        const size = side === 'original' ? original.length : chinese.length;
        if (!Array.isArray(link?.[side]) || !link[side].length) return null;
        for (const id of link[side]) {
          if (!Number.isInteger(id) || id < 0 || id >= size || used[side].has(id)) return null;
          used[side].add(id);
        }
      }
      links.push({ id: `p${page}-b${item.paragraph}-s${index}`, original: [...link.original], chinese: [...link.chinese] });
    }
    if (used.original.size !== original.length || used.chinese.size !== chinese.length) return null;
    result.push({ paragraph: item.paragraph, original, chinese, links });
  }
  return { version: ALIGNMENT_VERSION, number: page, input, paragraphs: result.sort((a, b) => a.paragraph - b.paragraph) };
}

export function alignmentMatches(alignment, input) {
  if (Array.isArray(input) && !input.length) return true;
  return alignmentCurrent(alignment, input) && alignment.paragraphs.length === input.length &&
    input.every(item => alignment.paragraphs.some(entry => entry.paragraph === item.paragraph));
}

export function alignmentCurrent(alignment, input) {
  return alignment?.version === ALIGNMENT_VERSION && Array.isArray(alignment.paragraphs) &&
    JSON.stringify(alignment.input) === JSON.stringify(input);
}

export function withParagraphFallback(alignment, input, page) {
  const previous = alignmentCurrent(alignment, input) ? alignment.paragraphs : [];
  return { version: ALIGNMENT_VERSION, number: page, input,
    paragraphs: input.map(item => previous.find(entry => entry.paragraph === item.paragraph) || {
      paragraph: item.paragraph, granularity: 'paragraph',
      original: [[0, item.original.length]], chinese: [[0, item.chinese.length]],
      links: [{ id: `p${page}-b${item.paragraph}-paragraph`, original: [0], chinese: [0] }],
    }) };
}

export function highlightRanges(alignment, paragraph, side) {
  const item = alignment?.paragraphs?.find(entry => entry.paragraph === paragraph);
  if (!item) return [];
  return item.links.flatMap(link => link[side].map(index => ({ id: link.id, start: item[side][index][0], end: item[side][index][1] })))
    .sort((a, b) => a.start - b.start);
}

export function exportAlignment(visualPages, alignments = []) {
  const inputs = alignmentInputs(visualPages);
  return { version: ALIGNMENT_VERSION, offsetUnit: 'UTF-16', rangeConvention: '[start,end)',
    pages: visualPages.flatMap((page, index) => {
      if (!page) return [];
      if (!inputs[index].length) return [{ version: ALIGNMENT_VERSION, number: page.number,
        input: [], paragraphs: [], complete: true }];
      const alignment = alignments[index];
      return alignmentCurrent(alignment, inputs[index])
        ? [{ ...alignment, complete: alignmentMatches(alignment, inputs[index]) }] : [];
    }) };
}
