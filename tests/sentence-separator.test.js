import test from 'node:test';
import assert from 'node:assert/strict';
import { SENTENCE_SEPARATOR as sep } from '../src/alignment/sentence-separator.js';
import { separatorAlignment, highlightRanges } from '../src/alignment/sentence-alignment.js';
import { displayParagraphText } from '../src/reader/visual-format.js';
import { translateVisualPage } from '../src/translation/vision-api.js';

const page = (original, chinese) => [{ number: 1, paragraphs: [{ kind: 'paragraph', original, chinese }] }];

test('one screenshot response supplies matching semantic groups without another request', async () => {
  let calls = 0;
  const paragraphs = page(`First $x^2$. ${sep}Second **sentence**.`, `第一句$x^2$。${sep}第二**句**。`)[0].paragraphs;
  const result = await translateVisualPage('data:image/jpeg;base64,test', 'test', { fetchImpl: async (_url, options) => {
    calls++;
    assert.ok(JSON.parse(options.body).messages[0].content[0].text.includes(sep));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ paragraphs }) } }] }) };
  } });
  const alignment = separatorAlignment([{ number: 1, paragraphs: result.paragraphs }])[0];
  assert.equal(calls, 1);
  assert.equal(alignment.paragraphs[0].links.length, 2);
  const original = highlightRanges(alignment, 0, 'original');
  const chinese = highlightRanges(alignment, 0, 'chinese');
  assert.equal(original[1].id, chinese[1].id);
  assert.equal(alignment.input[0].original.slice(original[1].start, original[1].end), 'Second **sentence**.');
  assert.ok(!displayParagraphText(paragraphs[0]).original.includes(sep));
  assert.deepEqual(result.paragraphs, paragraphs);
});

test('exact protocol preserves generic separators and supports emphasis spanning sentences', () => {
  const alignment = separatorAlignment(page(`**First [[[sep]]]. ${sep}Second.**`, `**第一句。${sep}第二句。**`))[0];
  assert.equal(alignment.paragraphs[0].links.length, 2);
  assert.ok(alignment.input[0].original.includes('[[[sep]]]'));
});

test('invalid boundaries safely fall back to paragraphs', () => {
  for (const [original, chinese] of [
    [`First.${sep}Second.`, '第一句。第二句。'],
    [`First.${sep}`, `第一句。${sep}`],
    [`$x${sep}+y$`, `甲${sep}乙`],
    ['Old record.', '旧记录。'],
  ]) {
    const alignment = separatorAlignment(page(original, chinese))[0];
    assert.equal(alignment.paragraphs[0].granularity, 'paragraph');
    assert.ok(!alignment.input[0].original.includes(sep));
  }
});

test('normalized headings, hidden repeated equations and original-only content retain valid offsets', () => {
  const pages = [{ number: 1, paragraphs: [
    { kind: 'heading', original: `First\nheading. ${sep}Second.`, chinese: `第一\n标题。${sep}第二。` },
    { kind: 'paragraph', original: `First $$x=1$$. ${sep}Second.`, chinese: `第一句$$x=1$$。${sep}第二句。` },
    { kind: 'reference', original: 'Citation.', chinese: '' },
  ] }];
  const alignment = separatorAlignment(pages)[0];
  assert.equal(alignment.paragraphs.length, 2);
  assert.ok(alignment.paragraphs.every(p => p.links.length === 2));
  assert.equal(alignment.input[0].original, 'First heading. Second.');
});

test('legacy saved separators still produce identical sentence ranges', async () => {
  const { LEGACY_SENTENCE_SEPARATOR, splitSentenceSegments } = await import('../src/alignment/sentence-separator.js');
  const old = separatorAlignment(page(`First. ${LEGACY_SENTENCE_SEPARATOR}Second.`, `第一句。${LEGACY_SENTENCE_SEPARATOR}第二句。`));
  const current = separatorAlignment(page(`First. ${sep}Second.`, `第一句。${sep}第二句。`));
  assert.deepEqual(old, current);
  assert.deepEqual(splitSentenceSegments('[[[s:other]]] [[[sep]]]'), ['[[[s:other]]] [[[sep]]]']);
  assert.ok(sep.length < 20);
});

test('thinking comparison is passed through the production screenshot request', async () => {
  for (const thinking of ['enabled', 'disabled']) {
    let calls = 0;
    await translateVisualPage('data:image/jpeg;base64,test', 'test', { thinking, fetchImpl: async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.thinking, { type: thinking });
      assert.match(body.messages[0].content[0].text, /both fields must contain the same number of separators/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"paragraphs":[]}' } }] }) };
    } });
    assert.equal(calls, 1);
  }
});

test('normal visual translation disables thinking by default', async () => {
  let calls = 0;
  await translateVisualPage('data:image/jpeg;base64,test', 'test', { fetchImpl: async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body).thinking, { type: 'disabled' });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"paragraphs":[]}' } }] }) };
  } });
  assert.equal(calls, 1);
});
