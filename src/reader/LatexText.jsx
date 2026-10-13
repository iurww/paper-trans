import katex from 'katex';
import 'katex/dist/katex.min.css';

import { mathPattern, normalizeLatexText } from '../rich-text.js';

const emphasisPattern = /(?<!\\)\*\*\*([\s\S]+?)\*\*\*|(?<!\\)___([\s\S]+?)___|(?<!\\)\*\*([\s\S]+?)\*\*|(?<!\\)__([\s\S]+?)__|(?<!\\)\*([\s\S]+?)\*|(?<![\w\\])_([\s\S]+?)_(?!\w)|\\(textit|textbf|emph)\{/g;
const placeholderPattern = /\uE000(\d+)\uE001|\uE002(\d*)\uE003/g;
const detachedTag = /\\tag\*?\{[^{}]+\}/;

function markSentences(text, ranges) {
  const events = ranges.flatMap((range, index) => [
    { offset: range.start, marker: `\uE002${index}\uE003`, order: 1 },
    { offset: range.end, marker: '\uE002\uE003', order: 0 },
  ]).sort((a, b) => a.offset - b.offset || a.order - b.order);
  let marked = '', last = 0;
  for (const event of events) {
    marked += text.slice(last, event.offset) + event.marker;
    last = event.offset;
  }
  return marked + text.slice(last);
}

function sentenceProps(context) {
  const range = context?.ranges[context.active];
  if (!range) return {};
  return {
    className: 'visual-sentence', 'data-sentence': range.id,
    tabIndex: 0,
    onPointerEnter: () => context.onSentenceHover?.(range.id),
    onPointerLeave: event => {
      if (event.relatedTarget?.closest?.('[data-sentence]')?.dataset.sentence !== range.id) context.onSentenceHover?.(null);
    },
    onFocus: () => context.onSentenceHover?.(range.id),
    onBlur: () => context.onSentenceHover?.(null),
  };
}

function closingBrace(text, start) {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\' && /[{}]/.test(text[index + 1] || '')) { index++; continue; }
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function renderMathAndText(text, formulas, prefix, context) {
  const pieces = [];
  const appendText = (value, key) => {
    if (value) pieces.push(<span key={key} {...sentenceProps(context)}>{value}</span>);
  };
  let last = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    appendText(text.slice(last, match.index), `${prefix}t${last}`);
    if (match[2] !== undefined && context) {
      context.active = match[2] === '' ? null : Number(match[2]);
    } else if (match[1] !== undefined) {
      const { formula, displayMode } = formulas[Number(match[1])];
      const html = katex.renderToString(formula, { displayMode, throwOnError: false, strict: 'ignore', trust: false, output: 'html' });
      const props = sentenceProps(context);
      pieces.push(<span key={`${prefix}m${match.index}`} {...props}
        className={`${displayMode ? 'latex-display' : 'latex-inline'}${props.className ? ` ${props.className}` : ''}`}
        dangerouslySetInnerHTML={{ __html: html }} />);
    } else appendText(match[0], `${prefix}r${match.index}`);
    last = match.index + match[0].length;
  }
  appendText(text.slice(last), `${prefix}t${last}`);
  return pieces;
}

function renderEmphasis(text, formulas, prefix = '', context) {
  const pieces = [];
  let last = 0;
  for (const match of text.matchAll(emphasisPattern)) {
    if (match.index < last) continue;
    if (match.index > last) pieces.push(...renderMathAndText(text.slice(last, match.index), formulas, `${prefix}p${last}`, context));
    if (match[7]) {
      const start = match.index + match[0].length;
      const end = closingBrace(text, start);
      if (end < 0) {
        pieces.push(...renderMathAndText(match[0], formulas, `${prefix}p${match.index}`, context));
        last = start;
        continue;
      }
      const children = renderEmphasis(text.slice(start, end), formulas, `${prefix}e${match.index}`, context);
      pieces.push(match[7] === 'textbf'
        ? <strong key={`${prefix}e${match.index}`}>{children}</strong>
        : <em key={`${prefix}e${match.index}`}>{children}</em>);
      last = end + 1;
      continue;
    }
    const inner = match.slice(1).find(value => value !== undefined);
    const children = renderEmphasis(inner, formulas, `${prefix}e${match.index}`, context);
    const both = match[1] !== undefined || match[2] !== undefined;
    const bold = both || match[3] !== undefined || match[4] !== undefined;
    pieces.push(both ? <strong key={`${prefix}e${match.index}`}><em>{children}</em></strong>
      : bold ? <strong key={`${prefix}e${match.index}`}>{children}</strong>
        : <em key={`${prefix}e${match.index}`}>{children}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push(...renderMathAndText(text.slice(last), formulas, `${prefix}p${last}`, context));
  return pieces;
}

export default function LatexText({ text = '', standaloneEquation = false, ranges = [], onSentenceHover }) {
  text = normalizeLatexText(text);
  const hasDisplayMath = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\begin\{(?:equation|align|gather|multline|displaymath)/.test(text);
  if ((standaloneEquation || detachedTag.test(text)) && !hasDisplayMath) {
    const formula = text.trim().replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, '$1')
      .replace(/\\\(([\s\S]+?)\\\)/g, '$1');
    try {
      const html = katex.renderToString(formula, { displayMode: true, throwOnError: true,
        strict: 'ignore', trust: false, output: 'html' });
      return <span className="latex-display" dangerouslySetInnerHTML={{ __html: html }} />;
    } catch { /* Fall back to readable source if KaTeX cannot parse this OCR result. */ }
  }
  const context = ranges.length ? { ranges, onSentenceHover, active: null } : undefined;
  if (context) text = markSentences(text, ranges);
  const formulas = [];
  const protectedText = text.replace(mathPattern, (_whole, dollars, brackets, inlineBrackets, inlineDollars, environment, body) => {
    const displayMode = Boolean(dollars || brackets || environment);
    const formula = dollars || brackets || inlineBrackets || inlineDollars || `\\begin{${environment}}${body}\\end{${environment}}`;
    const index = formulas.push({ formula, displayMode }) - 1;
    return `\uE000${index}\uE001`;
  });
  return <>{renderEmphasis(protectedText, formulas, '', context)}</>;
}
