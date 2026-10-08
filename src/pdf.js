import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const heading = /^(?:references|bibliography|literature cited|参考文献)\s*$/i;
const caption = /^(?:fig(?:ure)?\.?|table|图|表)\s*[\dIVX]+[\s.:：-]/i;
const note = /^(?:notes?|source|footnotes?|注(?:释)?|来源)\s*[:：.]|^[*†‡]\s+\S/i;
const math = /[=∑∫√≈≠≤≥∞∂∇∏∈∉⊂⊆→←↔±×÷∝α-ωΑ-Ω]|[\u{1D400}-\u{1D7FF}]|\$|\\(?:begin|end|frac|sum|int|label|tag|ref|eqref|\[|\(|\{|[A-Za-z])|[A-Za-z][_^][{(]?[A-Za-z0-9]/u;
const shortHeading = /^(?:abstract|introduction|conclusion|discussion|methodology|methods?|results?|keywords?|acknowledg(?:e)?ments?|\d+(?:\.\d+)*\s+[A-Za-z])/i;

function bounds(items, height) {
  const x0 = Math.min(...items.map(item => item.transform[4]));
  const x1 = Math.max(...items.map(item => item.transform[4] + item.width));
  const y0 = Math.min(...items.map(item => height - item.transform[5] - Math.max(item.height, 1)));
  const y1 = Math.max(...items.map(item => height - item.transform[5] + Math.max(item.height * .2, 1)));
  return [x0, y0, x1, y1];
}

function classify(lines, width, state, pageNumber) {
  let tableUntil = -1;
  return lines.map((line, index) => {
    const text = line.source;
    if (heading.test(text)) state.references = true;
    if (/^table\s*[\dIVX]+[\s.:：-]/i.test(text)) tableUntil = line.rect[3] + 170;
    const inTable = line.rect[1] < tableUntil && !caption.test(text) && !note.test(text);
    const numericColumns = /(?:\s{2,}|\t).*(?:\d|±|%)/.test(text) ||
      (line.items.length >= 3 && line.items.filter(item => /\d/.test(item.str)).length >= 2 && text.length < 65);
    const equation = math.test(text) || line.items.some(item => /math|symbol|cmex|cmsy|cmmi|msam|msbm/i.test(item.fontName));
    const tooShort = text.length < 24 && line.fontSize < 12 && !caption.test(text) && !note.test(text) && !shortHeading.test(text) && !/^[A-Z][A-Za-z\s]{8,}$/.test(text);
    const narrow = line.rect[2] - line.rect[0] < width * .12;
    const runningHeader = pageNumber > 1 && line.rect[1] < 75;
    const protectedLine = state.references || inTable || numericColumns || equation || tooShort || narrow || runningHeader;
    return { ...line, kind: state.references ? 'reference' : inTable || numericColumns ? 'table' : equation ? 'formula' : protectedLine ? 'other' : note.test(text) ? 'note' : caption.test(text) ? 'caption' : 'prose', translate: !protectedLine };
  });
}

export async function readPdf(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const pages = [];
  const classification = { references: false };
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter(item => item.str?.trim() && item.width > 0);
    const lines = [];
    for (const item of items) {
      const baseline = item.transform[5];
      let line = lines.find(candidate => Math.abs(candidate.baseline - baseline) < Math.max(2, item.height * .38));
      if (!line) { line = { baseline, items: [] }; lines.push(line); }
      line.items.push(item);
    }
    const splitLines = lines.flatMap(line => {
      line.items.sort((a, b) => a.transform[4] - b.transform[4]);
      const groups = [[]];
      for (const item of line.items) {
        const last = groups.at(-1).at(-1);
        if (last && item.transform[4] - (last.transform[4] + last.width) > Math.max(22, item.height * 2.4)) groups.push([]);
        groups.at(-1).push(item);
      }
      return groups.map(items => ({ baseline: line.baseline, items }));
    });
    splitLines.sort((a, b) => b.baseline - a.baseline || a.items[0].transform[4] - b.items[0].transform[4]);
    const normalized = splitLines.map((line, index) => {
      const source = line.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
      return { id: `p${number}l${index}`, source, translation: '', rect: bounds(line.items, viewport.height), fontSize: Math.max(6, Math.min(16, Math.max(...line.items.map(item => item.height)))), items: line.items };
    });
    pages.push({ number, width: viewport.width, height: viewport.height,
      lines: classify(normalized, viewport.width, classification, number).map(({ items: _items, ...line }) => line) });
  }
  await task.destroy();
  return pages;
}

export async function renderPage(pdf, number, canvas, cssWidth) {
  const page = await pdf.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const cssScale = cssWidth / base.width;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: cssScale * pixelRatio });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  canvas.style.width = `${Math.round(base.width * cssScale)}px`;
  canvas.style.height = `${Math.round(base.height * cssScale)}px`;
  await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
}

export const openPdf = bytes => pdfjs.getDocument({ data: bytes.slice() }).promise;

function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const char of text) {
    if (char === '\n' || font.widthOfTextAtSize(line + char, size) > width && line) {
      lines.push(line);
      line = char === '\n' ? '' : char;
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

export async function exportPdf(sourceBytes, pages, fontData) {
  const pdf = await PDFDocument.load(sourceBytes);
  pdf.registerFontkit(fontkit);
  const fontBytes = fontData || await (await fetch(`${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.ttf`)).arrayBuffer();
  // fontkit's subset output drops some CJK glyph outlines; embed once, then use object streams.
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const warnings = [];
  for (const data of pages) {
    const page = pdf.getPage(data.number - 1);
    for (const line of data.lines.filter(item => item.translate && item.translation)) {
      const [x0, y0, x1, y1] = line.rect;
      const width = x1 - x0;
      const height = y1 - y0;
      let size = Math.min(line.fontSize, 13);
      let rows = [];
      while (size >= 4.5) {
        rows = wrap(line.translation, font, size, width);
        if (rows.length * size * 1.12 <= height + size * .35) break;
        size -= .3;
      }
      if (rows.length * size * 1.12 > height + size * .35) warnings.push(`第 ${data.number} 页 ${line.id} 译文可能超出原行`);
      page.drawRectangle({ x: x0, y: page.getHeight() - y1, width, height, color: rgb(1, 1, 1) });
      rows.forEach((row, index) => {
        if (index * size * 1.12 >= height) return;
        page.drawText(row, { x: x0, y: page.getHeight() - y0 - size * (index + .9), size, font, color: rgb(.12, .16, .18) });
      });
    }
  }
  const bytes = await pdf.save({ useObjectStreams: true, objectsPerTick: 100 });
  return { bytes, warnings };
}
