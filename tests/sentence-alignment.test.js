import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentInputs, sentenceCandidates, candidateInput, validateCandidateParagraph, validateAlignment, alignmentMatches, highlightRanges, exportAlignment, withParagraphFallback } from '../src/sentence-alignment.js';
import { alignVisualPage } from '../src/alignment-api.js';
import { createAlignmentRunner } from '../src/alignment-runner.js';
import { highlightSentence } from '../src/reader/sentence-highlight.js';

const text = { paragraph: 0, original: 'Same. Same.', chinese: '相同。相同。' };
const mapped = () => ({ paragraphs: [{ paragraph: 0, original: ['Same. ', 'Same.'], chinese: ['相同。', '相同。'],
  links: [{ original: [0], chinese: [0] }, { original: [1], chinese: [1] }] }] });
const fixture = (pages = 2) => ({ id: 'paper', visualPages: Array.from({ length: pages }, (_, i) => ({ number: i + 1,
  paragraphs: [{ kind: 'paragraph', original: text.original, chinese: text.chinese }] })) });
const fakeResponse = (parsed, usage = {}, finish_reason = 'stop') => ({ ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) }, finish_reason }], usage }) });

test('exact ranges distinguish repeated sentences, reject changes and stale snapshots', () => {
  const alignment = validateAlignment(mapped(), [text], 3);
  assert.deepEqual(alignment.paragraphs[0].original, [[0, 5], [6, 11]]);
  assert.deepEqual(highlightRanges(alignment, 0, 'chinese'), [
    { id: 'p3-b0-s0', start: 0, end: 3 }, { id: 'p3-b0-s1', start: 3, end: 6 },
  ]);
  assert.equal(alignmentMatches(alignment, [text]), true);
  assert.equal(alignmentMatches(alignment, [{ ...text, chinese: '改变。' }]), false);
  const wrong = mapped(); wrong.paragraphs[0].original[0] = 'Edited. ';
  assert.equal(validateAlignment(wrong, [text], 3), null);
  const incomplete = mapped(); incomplete.paragraphs[0].links.pop();
  assert.equal(validateAlignment(incomplete, [text], 3), null);
  const duplicate = mapped(); duplicate.paragraphs[0].links[1].original = [0];
  assert.equal(validateAlignment(duplicate, [text], 3), null);
  const extra = mapped(); extra.paragraphs.push(extra.paragraphs[0]);
  assert.equal(validateAlignment(extra, [text], 3), null);
});

test('supports reordered and merged/split translations without positional guessing', () => {
  const parsed = mapped();
  parsed.paragraphs[0].links = [{ original: [0], chinese: [1] }, { original: [1], chinese: [0] }];
  const result = validateAlignment(parsed, [text], 1);
  assert.equal(highlightRanges(result, 0, 'chinese')[0].id, 'p1-b0-s1');
  parsed.paragraphs[0].links = [{ original: [0, 1], chinese: [0, 1] }];
  assert.equal(validateAlignment(parsed, [text], 1).paragraphs[0].links.length, 1);
  parsed.paragraphs[0].chinese = ['相同。相同。'];
  parsed.paragraphs[0].links = [{ original: [0, 1], chinese: [0] }];
  assert.equal(validateAlignment(parsed, [text], 1).paragraphs[0].chinese.length, 1);
});

test('rejects boundaries inside formulae, markup delimiters and Unicode graphemes', () => {
  for (const [original, sentences] of [
    ['Use $x.y$. Done.', ['Use $x.', 'y$. Done.']],
    ['**One. Two.**', ['*', '*One. Two.**']],
    ['Use \\textit{one}.', ['Use \\text', 'it{one}.']],
    ['😀 Done.', ['\ud83d', '\ude00 Done.']],
    ['a\u0301. Done.', ['a', '\u0301. Done.']],
  ]) {
    assert.equal(validateAlignment({ paragraphs: [{ paragraph: 0, original: sentences, chinese: ['译文。'],
      links: [{ original: sentences.map((_, i) => i), chinese: [0] }] }] },
    [{ paragraph: 0, original, chinese: '译文。' }], 1), null, original);
  }
  const original = '**One. Two.**';
  const valid = { paragraphs: [{ paragraph: 0, original: ['**One. ', 'Two.**'], chinese: ['一。', '二。'],
    links: [{ original: [0], chinese: [0] }, { original: [1], chinese: [1] }] }] };
  assert.ok(validateAlignment(valid, [{ paragraph: 0, original, chinese: '一。二。' }], 1));
});

test('aligns displayed text after filtering and formula normalization, exports only current pages', () => {
  const pages = [{ number: 1, paragraphs: [
    { kind: 'author', original: 'An Author', chinese: '' },
    { kind: 'paragraph', original: 'Same. Same.', chinese: '相同。相同。' },
    { kind: 'paragraph', original: 'Math. $$x=1$$', chinese: '公式。 $$x=1$$' },
  ] }];
  const inputs = alignmentInputs(pages);
  assert.equal(inputs[0][0].paragraph, 1);
  assert.equal(inputs[0][1].chinese, '公式。');
  const parsed = mapped(); parsed.paragraphs[0].paragraph = 1;
  const alignment = validateAlignment(parsed, inputs[0].slice(0, 1), 1);
  assert.equal(exportAlignment([{ number: 1, paragraphs: pages[0].paragraphs.slice(0, 2) }], [alignment]).pages.length, 1);
  assert.equal(exportAlignment(pages, [alignment]).pages.length, 0);
});

test('alignment uses text-only requests, fixed cache prefix, no reasoning and measured usage', async () => {
  const bodies = [];
  const result = await alignVisualPage([text], 1, 'secret', { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.ok(body.messages.length === 2 || body.messages.length === 3);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(typeof body.messages[1].content, 'string');
    assert.deepEqual(JSON.parse(body.messages[1].content), { paragraphs: candidateInput([text]) });
    return bodies.length === 1 ? fakeResponse({ paragraphs: [] }, { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 5 })
      : fakeResponse(mapped(), { prompt_tokens: 10, completion_tokens: 10, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 0 });
  }, sleep: async () => {} });
  assert.deepEqual(bodies[0].messages, bodies[1].messages.slice(0, 2));
  assert.equal(result.usage.total_tokens, 32);
  assert.equal(result.usage.prompt_cache_hit_tokens, 15);
  assert.equal(result.usage.prompt_cache_miss_tokens, 5);
  let calls = 0;
  const empty = await alignVisualPage([], 2, '', { fetchImpl: () => { calls++; } });
  assert.equal(calls, 0); assert.deepEqual(empty.alignment.paragraphs, []);
});

test('invalid or truncated alignment fails independently and carries usage', async () => {
  let calls = 0;
  await assert.rejects(alignVisualPage([text], 1, 'secret', { fetchImpl: async () => {
    calls++; return fakeResponse(mapped(), { prompt_tokens: 10, completion_tokens: 10 }, 'length');
  }, sleep: async () => {} }), error => error.usage.total_tokens === 80);
  assert.equal(calls, 4);
});

test('pages align concurrently, failures fall back to paragraphs and retries skip completed pages', async () => {
  let record = fixture();
  let active = 0, maxActive = 0;
  const calls = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const run = createAlignmentRunner({
    get: async () => record,
    update: async (_id, transform) => { record = transform(record); return record; },
    align: async (input, number) => {
      calls.push(number); active++; maxActive = Math.max(maxActive, active);
      if (active === 2) release();
      await barrier; active--;
      if (number === 2 && calls.length === 2) {
        const error = new Error('bad mapping'); error.usage = { total_tokens: 5 }; throw error;
      }
      return { alignment: validateAlignment(mapped(), input, number), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 7 } };
    },
  });
  await run('paper', 'key');
  assert.equal(maxActive, 2);
  assert.equal(record.alignmentStatus, 'done');
  assert.equal(record.sentenceAlignments[0].paragraphs[0].original.length, 2);
  assert.equal(record.sentenceAlignments[1].paragraphs[0].granularity, 'paragraph');
  assert.equal(record.alignmentPageErrors[2], undefined);
  assert.equal(record.visualPages[1].paragraphs[0].chinese, text.chinese);
  await run('paper', 'key'); assert.equal(calls.length, 2);
  await run('paper', 'key', { retry: true, onlyPage: 2 });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(record.alignmentStatus, 'done');
  assert.equal(record.alignmentTokens.total, 20);
  assert.equal(record.alignmentTokens.cacheHit, 7);
  await run('paper', 'key'); assert.equal(calls.length, 2);
});

test('changed source while a request is in flight cannot receive stale highlighting', async () => {
  let record = fixture(1);
  let finish, started;
  const barrier = new Promise(resolve => { finish = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const run = createAlignmentRunner({ get: async () => record,
    update: async (_id, transform) => { record = transform(record); return record; },
    align: async (input, number) => { started(); await barrier; return { alignment: validateAlignment(mapped(), input, number), usage: { total_tokens: 7 } }; },
  });
  const pending = run('paper', 'key'); await began;
  record = fixture(1); record.visualPages[0].paragraphs[0].chinese = 'Changed';
  finish(); await pending;
  assert.equal(record.sentenceAlignments[0].input[0].chinese, 'Changed');
  assert.equal(record.sentenceAlignments[0].paragraphs[0].granularity, 'paragraph');
  assert.equal(record.alignmentTokens.total, 7);
  assert.equal(record.alignmentStatus, 'done');
});

test('bidirectional highlighting marks exactly the matching sentence group across both languages', () => {
  const nodes = ['p1-b0-s0', 'p1-b0-s1', 'p1-b0-s0', 'p1-b0-s1', 'p2-b0-s0'].map(id => ({
    dataset: { sentence: id }, active: false, classList: { toggle(_name, active) { this.owner.active = active; } },
  }));
  nodes.forEach(node => { node.classList.owner = node; });
  const root = { querySelectorAll: () => nodes };
  highlightSentence(root, nodes[0].dataset.sentence);
  assert.deepEqual(nodes.map(node => node.active), [true, false, true, false, false]);
  highlightSentence(root, nodes[3].dataset.sentence);
  assert.deepEqual(nodes.map(node => node.active), [false, true, false, true, false]);
  highlightSentence(root, null);
  assert.ok(nodes.every(node => !node.active));
});

test('resuming after final-page save recovers completion without another paid request', async () => {
  let record = fixture(1);
  record.sentenceAlignments = [validateAlignment(mapped(), [text], 1)];
  record.alignmentStatus = 'working';
  let calls = 0;
  const run = createAlignmentRunner({ get: async () => record,
    update: async (_id, transform) => { record = transform(record); return record; },
    align: async () => { calls++; },
  });
  await run('paper', 'key');
  assert.equal(record.alignmentStatus, 'done');
  assert.equal(calls, 0);
});

test('source-derived sentence candidates preserve abbreviations, math and spanning emphasis exactly', () => {
  for (const source of ['Dr. Smith uses $x.y$. Next sentence.', '**First sentence. Second sentence.**',
    '\\textit{First sentence. Second sentence.}', 'Use $x=1.25$ with citations. Next sentence.', '相同。相同。']) {
    const parts = sentenceCandidates(source);
    assert.equal(parts.join(''), source);
    assert.equal(parts.length, 2, source);
  }
  const input = [{ paragraph: 0, original: '**First sentence. Second sentence.**', chinese: '第一句。第二句。' }];
  const item = validateCandidateParagraph({ paragraph: 0, links: [
    { original: [0], chinese: [0] }, { original: [1], chinese: [1] },
  ] }, input[0], candidateInput(input)[0], 1);
  assert.ok(item);
  assert.deepEqual(item.original, [[0, 17], [18, 36]]);
});

test('index-only responses tolerate scalar/string IDs and merge overlapping split links safely', async () => {
  const result = await alignVisualPage([text], 1, 'key', { fetchImpl: async () => fakeResponse({ links: [
    { original: '0', chinese: [0] }, { original: [0], chinese: ['1'] }, { original: [1], chinese: [1] },
  ] }) });
  assert.deepEqual(result.alignment.paragraphs[0].links[0].original, [0, 1]);
  assert.deepEqual(result.alignment.paragraphs[0].links[0].chinese, [0, 1]);
  assert.equal(result.alignment.input[0].original, text.original);
});

test('repairs only failed paragraphs and preserves successful paragraph mappings', async () => {
  const input = [text, { ...text, paragraph: 1 }];
  const requests = [], checkpoints = [];
  const result = await alignVisualPage(input, 1, 'key', {
    onProgress: async partial => checkpoints.push(partial),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const paragraphs = JSON.parse(body.messages[1].content).paragraphs;
      requests.push(paragraphs.map(item => item.paragraph));
      if (requests.length === 1) return fakeResponse({ paragraphs: [
        { paragraph: 0, links: [{ original: [0], chinese: [0] }, { original: [1], chinese: [1] }] },
        { paragraph: 1, links: [{ original: [0], chinese: [0] }] }, // missing sentence
      ] });
      return fakeResponse({ paragraphs: [{ paragraph: 1, links: [
        { original: [0], chinese: [1] }, { original: [1], chinese: [0] },
      ] }] });
    },
  });
  assert.deepEqual(requests, [[0, 1], [1]]);
  assert.equal(checkpoints[0].paragraphs.length, 1);
  assert.equal(result.alignment.paragraphs.length, 2);
  assert.equal(result.alignment.paragraphs[1].links[0].chinese[0], 1);
});

test('partial mappings survive failed repairs, export and resume without paying for valid paragraphs again', async () => {
  const input = [text, { ...text, paragraph: 1 }];
  let partial;
  await assert.rejects(alignVisualPage(input, 1, 'key', {
    fetchImpl: async (_url, options) => {
      const requested = JSON.parse(JSON.parse(options.body).messages[1].content).paragraphs;
      if (requested.length === 2) return fakeResponse({ paragraphs: [mapped().paragraphs[0]] });
      return fakeResponse({ paragraphs: [{ paragraph: 1, links: [{ original: [9], chinese: [0] }] }] });
    },
  }), error => {
    partial = error.partialAlignment;
    return partial?.paragraphs.length === 1;
  });
  assert.equal(alignmentMatches(partial, input), false);
  const visualPages = [{ number: 1, paragraphs: input.map(({ original, chinese }) => ({ kind: 'paragraph', original, chinese })) }];
  assert.equal(exportAlignment(visualPages, [partial]).pages[0].complete, false);
  const result = await alignVisualPage(input, 1, 'key', { previousAlignment: partial,
    fetchImpl: async (_url, options) => {
      const requested = JSON.parse(JSON.parse(options.body).messages[1].content).paragraphs;
      assert.deepEqual(requested.map(item => item.paragraph), [1]);
      return fakeResponse({ paragraphs: [{ ...mapped().paragraphs[0], paragraph: 1 }] });
    },
  });
  assert.equal(alignmentMatches(result.alignment, input), true);
  assert.deepEqual(result.alignment.paragraphs[0], partial.paragraphs[0]);
});

test('non-bilingual pages are complete by default without a key, model call or saved mapping', async () => {
  let record = { id: 'paper', visualPages: [
    { number: 1, paragraphs: [{ kind: 'reference', original: 'A reference', chinese: '' }] },
    { number: 2, paragraphs: [] },
    { number: 3, paragraphs: [{ kind: 'equation', original: '$$x=1$$', chinese: '' }] },
  ] };
  let calls = 0;
  const run = createAlignmentRunner({ get: async () => record,
    update: async (_id, transform) => { record = transform(record); return record; },
    align: async () => { calls++; },
  });
  await run('paper', '');
  assert.equal(calls, 0);
  assert.equal(record.alignmentStatus, 'done');
  assert.equal(record.sentenceAlignments, undefined);
  for (const input of alignmentInputs(record.visualPages)) assert.equal(alignmentMatches(null, input), true);
  const exported = exportAlignment(record.visualPages);
  assert.equal(exported.pages.length, 3);
  assert.ok(exported.pages.every(page => page.complete && !page.paragraphs.length));
});

test('paragraph fallback preserves precise entries and copies full saved text ranges without changing content', () => {
  const input = [text, { ...text, paragraph: 1, original: '  **One. Two.**\n', chinese: '  一。二。\n' }];
  const partial = { ...validateAlignment(mapped(), [text], 1), input };
  const complete = withParagraphFallback(partial, input, 1);
  assert.deepEqual(complete.paragraphs[0], partial.paragraphs[0]);
  assert.equal(complete.paragraphs[1].granularity, 'paragraph');
  assert.deepEqual(complete.paragraphs[1].original, [[0, input[1].original.length]]);
  assert.deepEqual(complete.paragraphs[1].chinese, [[0, input[1].chinese.length]]);
  assert.equal(highlightRanges(complete, 1, 'original')[0].id, highlightRanges(complete, 1, 'chinese')[0].id);
  assert.equal(alignmentMatches(complete, input), true);
  assert.deepEqual(complete.input, input);
});

test('legacy failed pages migrate to paragraph fallback locally and clear old errors without paid requests', async () => {
  let record = fixture();
  record.alignmentStatus = 'error';
  record.alignmentError = 'Missing two pages';
  record.alignmentPageErrors = { 1: 'Invalid JSON', 2: 'Missing indices' };
  record.sentenceAlignments = [validateAlignment(mapped(), [text], 1)];
  let calls = 0;
  const run = createAlignmentRunner({ get: async () => record,
    update: async (_id, transform) => { record = transform(record); return record; },
    align: async () => { calls++; },
  });
  await run('paper', 'key');
  assert.equal(calls, 0);
  assert.equal(record.alignmentStatus, 'done');
  assert.equal(record.alignmentError, '');
  assert.deepEqual(record.alignmentPageErrors, {});
  assert.equal(record.sentenceAlignments[0].paragraphs[0].original.length, 2);
  assert.equal(record.sentenceAlignments[1].paragraphs[0].granularity, 'paragraph');
  assert.ok(alignmentInputs(record.visualPages).every((input, index) => alignmentMatches(record.sentenceAlignments[index], input)));
});
