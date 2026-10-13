export const mathPattern = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|\\\[([\s\S]+?)(?<!\\)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}([\s\S]+?)\\end\{\5\}/g;

export function normalizeLatexText(text) {
  return text.replace(/\$\$([\s\S]+?)\$\$\s*(\\tag\*?\{[^{}]+\})/g,
    (_whole, formula, tag) => `$$${formula} ${tag}$$`)
    .replace(/\\\[([\s\S]+?)\\\]\s*(\\tag\*?\{[^{}]+\})/g,
      (_whole, formula, tag) => `\\[${formula} ${tag}\\]`)
    .replace(/(?<!\$)\$([^$\n]*?\\tag\*?\{[^{}]+\}[^$\n]*?)\$(?!\$)/g,
      (_whole, formula) => `$$${formula}$$`)
    .replace(/\\\(([\s\S]*?\\tag\*?\{[^{}]+\}[\s\S]*?)\\\)/g,
      (_whole, formula) => `\\[${formula}\\]`);
}

// Ranges use JavaScript UTF-16 offsets. Boundaries may cross emphasis content,
// but never split a formula, markup delimiter, escape or Unicode grapheme.
export function validRichTextBoundaries(text, boundaries) {
  if (/[\uE000-\uE003]/.test(text)) return false;
  const protectedTokens = [...text.matchAll(mathPattern),
    ...text.matchAll(/\\[A-Za-z]+\*?\{|\\[A-Za-z]+|\\[^A-Za-z]|[*_]+/g)];
  const graphemes = new Set([text.length,
    ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.index)]);
  return boundaries.every(position => graphemes.has(position) &&
    !protectedTokens.some(token => position > token.index && position < token.index + token[0].length));
}
