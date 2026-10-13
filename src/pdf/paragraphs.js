const sentenceBoundary = /(?<=[.!?。！？])\s+(?=\S)/g;

function lane(line, pageWidth) {
  const [left, , right] = line.rect;
  if (line.rect[1] < 125 && line.fontSize >= 14 && Math.abs((left + right) / 2 - pageWidth / 2) < pageWidth * .13) return 'wide';
  return right - left > pageWidth * .58 ? 'wide' : (left + right) / 2 < pageWidth / 2 ? 'left' : 'right';
}

function canJoin(previous, current, pageWidth) {
  if (lane(previous, pageWidth) !== lane(current, pageWidth)) return false;
  if (previous.kind !== current.kind && !(['caption', 'note'].includes(previous.kind) && current.kind === 'prose')) return false;
  if (!['prose', 'caption', 'note'].includes(previous.kind)) return false;
  const gap = current.rect[1] - previous.rect[3];
  const height = Math.max(previous.fontSize, current.fontSize);
  if (gap < -height * .5 || gap > height * 1.15) return false;
  if (Math.abs(previous.fontSize - current.fontSize) > 1.6) return false;
  const overlap = Math.min(previous.rect[2], current.rect[2]) - Math.max(previous.rect[0], current.rect[0]);
  if (overlap < Math.min(previous.rect[2] - previous.rect[0], current.rect[2] - current.rect[0]) * .5) return false;
  const previousShort = previous.rect[2] - previous.rect[0] < pageWidth * (lane(previous, pageWidth) === 'wide' ? .42 : .28);
  const centeredTitle = previous.rect[1] < 125 && previous.fontSize >= 14;
  const newIndent = !centeredTitle && current.rect[0] - previous.rect[0] > height * .7;
  return (!previousShort || previous.kind !== 'prose') && !newIndent;
}

function splitSentences(lines, blockId) {
  const segments = [];
  let source = '';
  for (const line of lines) {
    if (source) {
      if (/[A-Za-z]-$/.test(source) && /^[a-z]/.test(line.source)) {
        source = source.slice(0, -1);
        segments.at(-1).end--;
      } else source += ' ';
    }
    const start = source.length;
    source += line.source;
    segments.push({ start, end: source.length, line });
  }
  const ranges = [];
  let start = 0;
  for (const match of source.matchAll(sentenceBoundary)) {
    ranges.push([start, match.index]);
    start = match.index + match[0].length;
  }
  ranges.push([start, source.length]);
  return { source, sentences: ranges.map(([start, end], index) => {
    const rects = segments.flatMap(({ start: lineStart, end: lineEnd, line }) => {
      const first = Math.max(start, lineStart), last = Math.min(end, lineEnd);
      if (last <= first) return [];
      const [x0, y0, x1, y1] = line.rect;
      const length = Math.max(1, lineEnd - lineStart);
      return [[x0 + (x1 - x0) * (first - lineStart) / length, y0,
        x0 + (x1 - x0) * (last - lineStart) / length, y1]];
    });
    return { id: `${blockId}s${index}`, source: source.slice(start, end).trim(), translation: '', source_rects: rects, translation_rects: [] };
  }).filter(sentence => sentence.source) };
}

export function groupParagraphs(lines, pageWidth, pageNumber) {
  const groups = [];
  for (const key of ['wide', 'left', 'right']) {
    const candidates = lines.filter(line => line.translate && lane(line, pageWidth) === key)
      .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
    let group = [];
    for (const line of candidates) {
      if (group.length && !canJoin(group.at(-1), line, pageWidth)) {
        groups.push(group); group = [];
      }
      group.push(line);
    }
    if (group.length) groups.push(group);
  }
  groups.sort((a, b) => a[0].rect[1] - b[0].rect[1] || a[0].rect[0] - b[0].rect[0]);
  return groups.map((group, index) => {
    const id = `p${pageNumber}b${index}`;
    const { source, sentences } = splitSentences(group, id);
    return { id, kind: group[0].kind, source,
      rect: [Math.min(...group.map(line => line.rect[0])), Math.min(...group.map(line => line.rect[1])),
        Math.max(...group.map(line => line.rect[2])), Math.max(...group.map(line => line.rect[3]))],
      fontSize: group.reduce((sum, line) => sum + line.fontSize, 0) / group.length,
      sentences };
  });
}

export function layoutParagraph(block, font) {
  const [x0, y0, x1, y1] = block.rect;
  const width = x1 - x0, height = y1 - y0;
  const texts = block.sentences.map(sentence => sentence.translation.trim());
  let size = Math.min(block.fontSize, 13), rows;
  function arrange(fontSize) {
    const result = [{ text: '', spans: [] }];
    for (let index = 0; index < texts.length; index++) {
      const text = texts[index];
      if (!text) continue;
      if (index && result.at(-1).text && !/[\u3000-\u9fff]$/.test(result.at(-1).text)) {
        result.at(-1).text += ' ';
      }
      for (const char of text) {
        if (char === '\n') { result.push({ text: '', spans: [] }); continue; }
        let row = result.at(-1);
        if (row.text && font.widthOfTextAtSize(row.text + char, fontSize) > width) {
          row = { text: '', spans: [] }; result.push(row);
        }
        const start = font.widthOfTextAtSize(row.text, fontSize);
        row.text += char;
        const end = font.widthOfTextAtSize(row.text, fontSize);
        const span = row.spans.at(-1);
        if (span?.index === index) span.end = end;
        else row.spans.push({ index, start, end });
      }
    }
    return result;
  }
  while (true) {
    rows = arrange(size);
    if (rows.length * size * 1.16 <= height + size * .3 || size <= 4) break;
    size -= .25;
  }
  const rects = texts.map(() => []);
  rows.forEach((row, rowIndex) => row.spans.forEach(span => rects[span.index].push([
    x0 + span.start, y0 + rowIndex * size * 1.16, x0 + span.end, y0 + (rowIndex + 1) * size * 1.16
  ])));
  return { rows, size, rects, overflow: rows.length * size * 1.16 > height + size * .3 };
}
