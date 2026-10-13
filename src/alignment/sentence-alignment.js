import { splitSentenceSegments } from './sentence-separator.js';
import { visibleVisualPages } from '../translation/visual-content.js';
import { displayParagraphText } from '../reader/visual-format.js';
import { validRichTextBoundaries } from '../text/rich-text.js';

export const ALIGNMENT_VERSION = 1;

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

// Derive offsets from the same display normalization as the reader. Validation
// rejects empty groups, count mismatches and boundaries inside rich-text tokens.
export function separatorAlignment(visualPages, previous = []) {
  const inputs = alignmentInputs(visualPages);
  return visibleVisualPages(visualPages).map((paragraphs, index) => {
    if (!visualPages[index]) return null;
    const input = inputs[index];
    const generated = [];
    for (const basis of input) {
      const marked = displayParagraphText(paragraphs[basis.paragraph], { preserveSeparators: true });
      const original = splitSentenceSegments(marked.original);
      const chinese = splitSentenceSegments(marked.chinese);
      if (original.length !== chinese.length) continue;
      // Unmarked legacy prose has no claimed sentence boundaries.
      if (original.length === 1) continue;
      const valid = validateAlignment({ paragraphs: [{ paragraph: basis.paragraph, original, chinese,
        links: original.map((_, id) => ({ original: [id], chinese: [id] })) }] }, [basis], index + 1);
      if (valid) generated.push(valid.paragraphs[0]);
    }
    const old = alignmentCurrent(previous[index], input) ? previous[index].paragraphs : [];
    return withParagraphFallback({ version: ALIGNMENT_VERSION, number: index + 1, input,
      paragraphs: input.flatMap(item => {
        const entry = generated.find(entry => entry.paragraph === item.paragraph) || old.find(entry => entry.paragraph === item.paragraph);
        return entry ? [entry] : [];
      }) }, input, index + 1);
  });
}
