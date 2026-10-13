import { originalOnlyKinds } from '../translation/visual-content.js';
import { normalizeLatexText } from '../text/rich-text.js';

import { stripSentenceSeparators } from '../alignment/sentence-separator.js';

const displayMath = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|\\\[([\s\S]+?)\\\]|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}([\s\S]+?)\\end\{\3\}/g;

const normalizeFormula = text => text.replace(/\s+/g, '');

export function displayParagraphText(paragraph, { preserveSeparators = false } = {}) {
  if (!preserveSeparators) paragraph = { ...paragraph,
    original: stripSentenceSeparators(paragraph.original),
    chinese: stripSentenceSeparators(paragraph.chinese || '') };
  const heading = paragraph.kind === 'title' || paragraph.kind === 'heading';
  const original = normalizeLatexText(heading ? paragraph.original.replace(/\s*\n\s*/g, ' ').trim() : paragraph.original);
  const chineseText = typeof paragraph.chinese === 'string' ? paragraph.chinese : '';
  if (paragraph.kind === 'equation' || paragraph.originalOnly || originalOnlyKinds.has(paragraph.kind) ||
    original.replace(/\s+/g, '') === chineseText.replace(/\s+/g, '')) return { original, chinese: '' };

  const originalFormulae = new Set([...original.matchAll(displayMath)]
    .map(match => normalizeFormula(match[1] || match[2] || match[4])));
  const chinese = chineseText.replace(displayMath, (whole, dollars, brackets, _environment, body) =>
    originalFormulae.has(normalizeFormula(dollars || brackets || body)) ? '' : whole)
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。；：、！？,.!?;:])/g, '$1').trim();
  return { original, chinese: normalizeLatexText(heading ? chinese.replace(/\s*\n\s*/g, ' ') : chinese) };
}
