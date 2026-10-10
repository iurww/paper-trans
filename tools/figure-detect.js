// Geometry proposal from the rendered PDF page and its text layer. Coordinates
// use the PDF.js scale=1 viewport (origin at the upper-left of the page).
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const overlap = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
const isCaption = text => /^(?:Extended\s+Data\s+)?(?:Fig(?:ure)?\.?|Table|图|表)\s*(?:S\s*\d|\d|[IVX]+)\s*[:：.、|\-]/i.test(text);

export function columnBounds(caption, pageWidth) {
  const [x0,,x1] = caption;
  const middle = (x0 + x1) / 2;
  if (x1 - x0 >= pageWidth * .51 || Math.abs(middle - pageWidth / 2) < pageWidth * .065) return [pageWidth * .055, pageWidth * .945];
  return middle < pageWidth / 2 ? [pageWidth * .065, pageWidth * .495] : [pageWidth * .505, pageWidth * .935];
}

export function completeCaption(candidate, lines, pageWidth) {
  let rect = [...candidate.caption];
  const region = columnBounds(rect, pageWidth);
  const lineHeight = Math.max(6, rect[3] - rect[1]);
  const used = new Set();
  for (let count = 0; count < 9; count++) {
    const possible = lines.map((line,index) => ({line,index})).filter(({line,index}) => {
      if (used.has(index) || line.rect[1] < rect[3] - 2.5 || line.rect[1] > rect[3] + 7) return false;
      if (isCaption(line.text)) return false;
      if (Math.abs((line.rect[3] - line.rect[1]) - lineHeight) > 3.5) return false;
      const lineRange = [line.rect[0], line.rect[2]];
      if (overlap(lineRange, region) < Math.min(15, line.rect[2] - line.rect[0]) * .8) return false;
      return overlap(lineRange, [rect[0] - 8, rect[2] + 8]) > 8;
    }).sort((a,b) => a.line.rect[1] - b.line.rect[1] || b.line.rect[2] - b.line.rect[0] - (a.line.rect[2] - a.line.rect[0]));
    if (!possible.length) break;
    const {line,index} = possible[0];
    used.add(index);
    rect = union(rect, line.rect);
  }
  return rect;
}

export function makeInkMap(rgba, pixelWidth, pixelHeight, lines, scale = 1) {
  const map = new Uint8Array(pixelWidth * pixelHeight);
  for (let y = 0; y < pixelHeight; y++) for (let x = 0; x < pixelWidth; x++) {
    const i = 4 * (y * pixelWidth + x);
    if (Math.min(rgba[i], rgba[i+1], rgba[i+2]) < 225) map[y * pixelWidth + x] = 1;
  }
  // Remove selectable text so prose does not become a "figure". Chart axes and
  // table cell text are added from their original text rectangles later.
  for (const {rect} of lines) {
    const x0 = clamp(Math.floor(rect[0] * scale - 2), 0, pixelWidth);
    const y0 = clamp(Math.floor(rect[1] * scale - 2), 0, pixelHeight);
    const x1 = clamp(Math.ceil(rect[2] * scale + 2), 0, pixelWidth);
    const y1 = clamp(Math.ceil(rect[3] * scale + 2), 0, pixelHeight);
    for (let y = y0; y < y1; y++) map.fill(0, y * pixelWidth + x0, y * pixelWidth + x1);
  }
  return map;
}

function graphicBand(map, pixelWidth, pixelHeight, scale, region, anchor, direction, boundary) {
  const x0 = clamp(Math.floor(region[0] * scale), 0, pixelWidth - 1);
  const x1 = clamp(Math.ceil(region[1] * scale), x0 + 1, pixelWidth);
  const y0 = clamp(Math.floor(Math.min(anchor, boundary) * scale), 0, pixelHeight - 1);
  const y1 = clamp(Math.ceil(Math.max(anchor, boundary) * scale), y0 + 1, pixelHeight);
  const active = [];
  for (let y = y0; y < y1; y++) {
    let count = 0;
    for (let x = x0; x < x1; x++) count += map[y * pixelWidth + x];
    if (count >= 3) active.push(y);
  }
  if (!active.length) return null;
  const ordered = direction === 'above' ? active.reverse() : active;
  const edge = anchor * scale;
  if (Math.abs(ordered[0] - edge) > 48 * scale) return null;
  let last = ordered[0], end = last;
  for (const y of ordered.slice(1)) {
    if (Math.abs(y - last) > 45 * scale) break;
    end = y; last = y;
  }
  const top = Math.min(ordered[0], end), bottom = Math.max(ordered[0], end);
  let left = pixelWidth, right = -1, pixels = 0;
  for (let y = top; y <= bottom; y++) for (let x = x0; x < x1; x++) {
    if (!map[y * pixelWidth + x]) continue;
    left = Math.min(left, x); right = Math.max(right, x); pixels++;
  }
  if (right < left || pixels < 60 || (bottom - top) / scale < 18 || (right - left) / scale < 35) return null;
  return {rect:[left / scale, top / scale, (right + 1) / scale, (bottom + 1) / scale], pixels};
}

function nearbyCaptionBoundary(candidate, candidates, region, direction, fallback) {
  const edge = direction === 'above' ? candidate.caption[1] : candidate.caption[3];
  const nearby = candidates.filter(other => other !== candidate && overlap([other.caption[0],other.caption[2]],region) > 20)
    .filter(other => direction === 'above' ? other.caption[3] < edge : other.caption[1] > edge)
    .map(other => direction === 'above' ? other.caption[3] + 4 : other.caption[1] - 4);
  return nearby.length ? (direction === 'above' ? Math.max(fallback,...nearby) : Math.min(fallback,...nearby)) : fallback;
}

function includeFigureLabels(rect, lines, region) {
  let result = rect;
  for (const line of lines) {
    const box = line.rect;
    if (box[1] < rect[1] - 13 || box[3] > rect[3] + 12) continue;
    if (overlap([box[0],box[2]],region) < 5) continue;
    if (line.text.length > 65 || box[2] - box[0] > 150) continue;
    if (overlap([box[0],box[2]],[rect[0] - 24,rect[2] + 24]) < 5) continue;
    result = union(result,box);
  }
  return result;
}

function tableTextRows(lines, caption, region, direction, boundary) {
  const sorted = lines.filter(line => overlap([line.rect[0],line.rect[2]],region) > 3)
    .filter(line => direction === 'below' ? line.rect[1] >= caption[3] - 1 && line.rect[1] < boundary : line.rect[3] <= caption[1] + 1 && line.rect[3] > boundary)
    .sort((a,b) => direction === 'below' ? a.rect[1] - b.rect[1] : b.rect[3] - a.rect[3]);
  const rows = [];
  for (const line of sorted) {
    const existing = rows.find(row => Math.abs(row.y - line.rect[1]) < 2.7);
    if (existing) { existing.items.push(line); existing.rect = union(existing.rect,line.rect); }
    else rows.push({y:line.rect[1],items:[line],rect:[...line.rect]});
  }
  let chosen = [], edge = direction === 'below' ? caption[3] : caption[1];
  for (const row of rows) {
    const gap = direction === 'below' ? row.rect[1] - edge : edge - row.rect[3];
    if (gap > (chosen.length ? 19 : 24)) break;
    if (row.items.some(item => isCaption(item.text))) break;
    const joined = row.items.map(item => item.text).join(' ');
    const digits = (joined.match(/\d/g) || []).length;
    const note = /^(?:Note|Source|\*|†|‡|Bold values)/i.test(joined);
    const structured = row.items.length >= 2 || digits >= 2;
    if (!structured && !note && (chosen.length >= 2 || joined.length > 45)) break;
    chosen.push(row);
    edge = direction === 'below' ? row.rect[3] : row.rect[1];
  }
  if (!chosen.length) return null;
  const rect = chosen.reduce((all,row) => union(all,row.rect),chosen[0].rect);
  const structure = chosen.filter(row => row.items.length >= 2 || /\d/.test(row.items.map(item => item.text).join(''))).length;
  if (structure < 1) return null;
  return {rect, rows:chosen, score:Math.min(structure,8) * 3 + Math.min(chosen.length,8) - Math.abs((direction === 'below' ? rect[1] - caption[3] : caption[1] - rect[3])) / 3};
}

function tableRules(map, pixelWidth, pixelHeight, scale, region, anchor, direction, boundary) {
  const x0 = clamp(Math.floor(region[0] * scale),0,pixelWidth - 1);
  const x1 = clamp(Math.ceil(region[1] * scale),x0 + 1,pixelWidth);
  const y0 = clamp(Math.floor(Math.min(anchor,boundary) * scale),0,pixelHeight - 1);
  const y1 = clamp(Math.ceil(Math.max(anchor,boundary) * scale),y0 + 1,pixelHeight);
  const ruleRows = [];
  for (let y=y0; y<y1; y++) {
    let run=0, longest=0, start=0, bestStart=0, bestEnd=0;
    for (let x=x0; x<x1; x++) {
      if (map[y*pixelWidth+x]) { if (!run) start=x; run++; }
      else { if (run>longest) {longest=run;bestStart=start;bestEnd=x;} run=0; }
    }
    if (run>longest) {longest=run;bestStart=start;bestEnd=x1;}
    if (longest >= (x1-x0)*.43) ruleRows.push({y,x0:bestStart,x1:bestEnd});
  }
  const unique=[];
  for (const row of ruleRows) if (!unique.length || row.y-unique.at(-1).y > 3*scale) unique.push(row);
  if (unique.length < 2) return null;
  const first=unique[0],last=unique.at(-1);
  if (Math.abs(first.y/scale-anchor)>50) return null;
  return {rect:[Math.min(...unique.map(row=>row.x0))/scale,first.y/scale,Math.max(...unique.map(row=>row.x1))/scale,(last.y+1)/scale],count:unique.length};
}

function includeTableNotes(body, lines, region, boundary) {
  const below = lines.filter(line => line.rect[1] >= body[3] - 1 && line.rect[1] < Math.min(body[3] + 45,boundary))
    .filter(line => overlap([line.rect[0],line.rect[2]],region) > 1)
    .sort((a,b) => a.rect[1] - b.rect[1]);
  if (!below.length || below[0].rect[1] - body[3] > 20 ||
      !/^(?:Note\b|Notes\b|Source\b|Sources\b|\*|†|‡|Bold\b)/i.test(below[0].text.trim())) return body;
  let result = union(body,below[0].rect), end = below[0].rect[3];
  for (const line of below.slice(1)) {
    if (line.rect[1] - end > 7 || isCaption(line.text)) break;
    result = union(result,line.rect); end = line.rect[3];
  }
  return result;
}

export function inferCrop({candidate,candidates,lines,ink,pixelWidth,pixelHeight,scale = 1,pageWidth,pageHeight,occupied = []}) {
  const caption = completeCaption(candidate,lines,pageWidth);
  const region = columnBounds(caption,pageWidth);
  let aboveLimit = nearbyCaptionBoundary(candidate,candidates,region,'above',Math.max(0,pageHeight * .035));
  let belowLimit = nearbyCaptionBoundary(candidate,candidates,region,'below',Math.min(pageHeight,pageHeight * .965));
  for (const box of occupied) {
    if (overlap([box[0],box[2]],region) < 20) continue;
    if (box[3] < caption[1]) aboveLimit = Math.max(aboveLimit,box[3] + 1);
    if (box[1] > caption[3]) belowLimit = Math.min(belowLimit,box[1] - 1);
  }
  const above = graphicBand(ink,pixelWidth,pixelHeight,scale,region,caption[1] - 3,'above',aboveLimit);
  const below = graphicBand(ink,pixelWidth,pixelHeight,scale,region,caption[3] + 3,'below',belowLimit);
  let body = null, direction = null, reason = null;
  if (candidate.kind === 'figure') {
    const chosen = above && below ? (above.pixels >= below.pixels * .8 ? above : below) : above || below;
    if (chosen) {
      body = includeFigureLabels(chosen.rect,lines,region);
      direction = chosen === above ? 'above' : 'below';
      reason = 'rendered_graphics';
    }
  } else {
    const textAbove = tableTextRows(lines,caption,region,'above',aboveLimit);
    const textBelow = tableTextRows(lines,caption,region,'below',belowLimit);
    const rulesAbove = tableRules(ink,pixelWidth,pixelHeight,scale,region,caption[1]-3,'above',aboveLimit);
    const rulesBelow = tableRules(ink,pixelWidth,pixelHeight,scale,region,caption[3]+3,'below',belowLimit);
    const scoreAbove = Math.max(textAbove?.score ?? -20,rulesAbove ? 8 + rulesAbove.count*2 : -20) + (above ? 1 : 0);
    const scoreBelow = Math.max(textBelow?.score ?? -20,rulesBelow ? 8 + rulesBelow.count*2 : -20) + (below ? 1 : 0) + 3;
    direction = scoreAbove > scoreBelow ? 'above' : 'below';
    const textBody = direction === 'above' ? textAbove : textBelow;
    const graphicBody = direction === 'above' ? above : below;
    const rules = direction === 'above' ? rulesAbove : rulesBelow;
    if (rules) {
      body = rules.rect;
      if (textBody) {
        const relevant = textBody.rows.filter(row => direction === 'below' ? row.rect[1] <= rules.rect[3] + 4 : row.rect[3] >= rules.rect[1] - 4);
        for (const row of relevant) body = union(body,row.rect);
      }
      reason = 'table_rules_and_rows';
    } else if (textBody) {
      body = graphicBody && overlap([textBody.rect[1] - 12,textBody.rect[3] + 12],[graphicBody.rect[1],graphicBody.rect[3]]) > 0 ? union(textBody.rect,graphicBody.rect) : textBody.rect;
      reason = 'table_rows';
    }
    if (body && direction === 'below') body = includeTableNotes(body,lines,region,belowLimit);
  }
  if (!body) return {box:null,reason:'no_reliable_body',caption,direction};
  const joined = union(caption,body);
  const padding = 3;
  const box = [clamp(joined[0] - padding,0,pageWidth),clamp(joined[1] - padding,0,pageHeight),clamp(joined[2] + padding,0,pageWidth),clamp(joined[3] + padding,0,pageHeight)].map(value => Math.round(value * 10) / 10);
  return {box,reason,caption,body,direction};
}
