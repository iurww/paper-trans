import katex from 'katex';
import 'katex/dist/katex.min.css';

const mathPattern = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}([\s\S]+?)\\end\{\5\}/g;
const emphasisPattern = /(?<!\\)\*\*\*([\s\S]+?)\*\*\*|(?<!\\)___([\s\S]+?)___|(?<!\\)\*\*([\s\S]+?)\*\*|(?<!\\)__([\s\S]+?)__|(?<!\\)\*([\s\S]+?)\*|(?<![\w\\])_([\s\S]+?)_(?!\w)|\\(textit|textbf|emph)\{/g;
const placeholderPattern = /\uE000(\d+)\uE001/g;
const detachedTag = /\\tag\*?\{[^{}]+\}/;

function attachDetachedTags(text) {
  return text.replace(/\$\$([\s\S]+?)\$\$\s*(\\tag\*?\{[^{}]+\})/g,
    (_whole, formula, tag) => `$$${formula} ${tag}$$`)
    .replace(/\\\[([\s\S]+?)\\\]\s*(\\tag\*?\{[^{}]+\})/g,
      (_whole, formula, tag) => `\\[${formula} ${tag}\\]`)
    .replace(/(?<!\$)\$([^$\n]*?\\tag\*?\{[^{}]+\}[^$\n]*?)\$(?!\$)/g,
      (_whole, formula) => `$$${formula}$$`)
    .replace(/\\\(([\s\S]*?\\tag\*?\{[^{}]+\}[\s\S]*?)\\\)/g,
      (_whole, formula) => `\\[${formula}\\]`);
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

function renderMathAndText(text, formulas, prefix) {
  const pieces = [];
  let last = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    if (match.index > last) pieces.push(<span key={`${prefix}t${last}`}>{text.slice(last, match.index)}</span>);
    const { formula, displayMode } = formulas[Number(match[1])];
    const html = katex.renderToString(formula, { displayMode, throwOnError: false, strict: 'ignore', trust: false, output: 'html' });
    pieces.push(<span key={`${prefix}m${match.index}`} className={displayMode ? 'latex-display' : 'latex-inline'} dangerouslySetInnerHTML={{ __html: html }} />);
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push(<span key={`${prefix}t${last}`}>{text.slice(last)}</span>);
  return pieces;
}

function renderEmphasis(text, formulas, prefix = '') {
  const pieces = [];
  let last = 0;
  for (const match of text.matchAll(emphasisPattern)) {
    if (match.index < last) continue;
    if (match.index > last) pieces.push(...renderMathAndText(text.slice(last, match.index), formulas, `${prefix}p${last}`));
    if (match[7]) {
      const start = match.index + match[0].length;
      const end = closingBrace(text, start);
      if (end < 0) {
        pieces.push(...renderMathAndText(match[0], formulas, `${prefix}p${match.index}`));
        last = start;
        continue;
      }
      const children = renderEmphasis(text.slice(start, end), formulas, `${prefix}e${match.index}`);
      pieces.push(match[7] === 'textbf'
        ? <strong key={`${prefix}e${match.index}`}>{children}</strong>
        : <em key={`${prefix}e${match.index}`}>{children}</em>);
      last = end + 1;
      continue;
    }
    const inner = match.slice(1).find(value => value !== undefined);
    const children = renderEmphasis(inner, formulas, `${prefix}e${match.index}`);
    const both = match[1] !== undefined || match[2] !== undefined;
    const bold = both || match[3] !== undefined || match[4] !== undefined;
    pieces.push(both ? <strong key={`${prefix}e${match.index}`}><em>{children}</em></strong>
      : bold ? <strong key={`${prefix}e${match.index}`}>{children}</strong>
        : <em key={`${prefix}e${match.index}`}>{children}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push(...renderMathAndText(text.slice(last), formulas, `${prefix}p${last}`));
  return pieces;
}

export default function LatexText({ text = '', standaloneEquation = false }) {
  text = attachDetachedTags(text);
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
  const formulas = [];
  const protectedText = text.replace(mathPattern, (_whole, dollars, brackets, inlineBrackets, inlineDollars, environment, body) => {
    const displayMode = Boolean(dollars || brackets || environment);
    const formula = dollars || brackets || inlineBrackets || inlineDollars || `\\begin{${environment}}${body}\\end{${environment}}`;
    const index = formulas.push({ formula, displayMode }) - 1;
    return `\uE000${index}\uE001`;
  });
  return <>{renderEmphasis(protectedText, formulas)}</>;
}
