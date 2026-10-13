import { mathPattern, validRichTextBoundaries } from '../src/text/rich-text.js';

// Heuristic candidates for manual audit only; never used for reader alignment.
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
