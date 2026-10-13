import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVisualPage, translateVisualPage, DEEPSEEK_VISION_ENDPOINT, DEEPSEEK_VISION_MODEL } from '../src/translation/vision-api.js';

test('sends the PDF screenshot to DeepSeek and preserves original and Chinese LaTeX in page JSON', async () => {
  const image = 'data:image/jpeg;base64,abc123';
  const paragraphs = [{ kind: 'equation', original: '$$E=mc^2$$', chinese: '' }];
  const result = await translateVisualPage(image, 'secret', { fetchImpl: async (url, options) => {
    assert.equal(url, DEEPSEEK_VISION_ENDPOINT);
    assert.equal(options.headers.Authorization, 'Bearer secret');
    const body = JSON.parse(options.body);
    assert.equal(body.model, DEEPSEEK_VISION_MODEL);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].content[1].image_url.url, image);
    assert.equal(body.messages[0].content[1].image_url.detail, 'original');
    assert.match(body.messages[0].content[0].text, /Skip table contents, printed page numbers and running headers/);
    assert.match(body.messages[0].content[0].text, /Transcribe authors, affiliations, contact information/);
    assert.match(body.messages[0].content[0].text, /only in original, with chinese=""/);
    assert.match(body.messages[0].content[0].text, /KaTeX-compatible LaTeX/);
    assert.match(body.messages[0].content[0].text, /never place \\tag outside/);
    assert.match(body.messages[0].content[0].text, /the References\/Bibliography heading and bibliography entries/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ paragraphs }) } }], usage: { total_tokens: 25 } }) };
  }, sleep: async () => {} });
  assert.deepEqual(result.paragraphs, paragraphs);
  assert.equal(result.usage.total_tokens, 25);
});

test('rejects incomplete paragraph pairs instead of saving partial OCR output', () => {
  assert.equal(parseVisualPage('{"paragraphs":[{"original":"text"}]}'), null);
  assert.deepEqual(parseVisualPage('{"paragraphs":[]}'), []);
});

test('omits table cells while retaining metadata and references only in their original language', () => {
  const content = JSON.stringify({ paragraphs: [
    { kind: 'table', original: 'Long table cell', chinese: '长表格单元格' },
    { kind: 'reference', original: '[1] Citation', chinese: '参考文献' },
    { kind: 'heading', original: 'References', chinese: '参考文献' },
    { kind: 'paragraph', original: '22', chinese: '22' },
    { kind: 'author', original: 'Rafael Rafailov', chinese: '拉斐尔·拉法伊洛夫' },
    { kind: 'affiliation', original: 'Stanford University', chinese: '斯坦福大学' },
    { kind: 'caption', original: 'Table 2: Results', chinese: '表 2：结果' },
  ] });
  assert.deepEqual(parseVisualPage(content), [
    { kind: 'reference', original: '[1] Citation', chinese: '' },
    { kind: 'heading', original: 'References', chinese: '' },
    { kind: 'author', original: 'Rafael Rafailov', chinese: '' },
    { kind: 'affiliation', original: 'Stanford University', chinese: '' },
    { kind: 'caption', original: 'Table 2: Results', chinese: '表 2：结果' },
  ]);
  assert.deepEqual(parseVisualPage('{"paragraphs":[{"kind":"contact","original":"author@stanford.edu","chinese":""}]}'),
    [{ kind: 'contact', original: 'author@stanford.edu', chinese: '' }]);
  assert.deepEqual(parseVisualPage('{"paragraphs":[{"kind":"reference","original":"[2] Citation","chinese":""}]}'),
    [{ kind: 'reference', original: '[2] Citation', chinese: '' }]);
  assert.deepEqual(parseVisualPage('{"paragraphs":[{"kind":"equation","original":"$$x=1 \\\\tag{9}$$","chinese":""}]}'),
    [{ kind: 'equation', original: '$$x=1 \\tag{9}$$', chinese: '' }]);
  assert.deepEqual(parseVisualPage('{"paragraphs":[{"kind":"footnote","original":"See note.","chinese":"见注释。"}]}'),
    [{ kind: 'footnote', original: 'See note.', chinese: '见注释。' }]);
});

test('drops segments that lack a translation without discarding the rest of the page', () => {
  assert.deepEqual(parseVisualPage(JSON.stringify({ paragraphs: [
    { kind: 'paragraph', original: 'First sentence.', chinese: '第一句。' },
    { kind: 'paragraph', original: 'Missing translation.', chinese: '' },
    { kind: 'caption', original: 'Figure 1.', chinese: '图 1。' },
    { original: 'No chinese field' },
  ] })), [
    { kind: 'paragraph', original: 'First sentence.', chinese: '第一句。' },
    { kind: 'caption', original: 'Figure 1.', chinese: '图 1。' },
  ]);
});

test('increases output allowance after truncated page JSON and counts both requests', async () => {
  const limits = [];
  const result = await translateVisualPage('data:image/jpeg;base64,abc', 'secret', {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      limits.push(body.max_tokens);
      const truncated = limits.length === 1;
      return { ok: true, json: async () => ({
        choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: truncated
          ? '{"paragraphs":[' : '{"paragraphs":[{"original":"Source","chinese":"译文"}]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }) };
    }, sleep: async () => {},
  });
  assert.deepEqual(limits, [32000, 64000]);
  assert.equal(result.usage.total_tokens, 60);
  assert.equal(result.paragraphs[0].chinese, '译文');
});

test('falls back to ordered paragraph batches when full-page JSON stays incomplete', async () => {
  const limits = [];
  const contents = [
    '{"paragraphs":[', '{"paragraphs":[',
    JSON.stringify({ paragraphs: [{ original: 'First paragraph', chinese: '第一段' }], has_more: true }),
    JSON.stringify({ paragraphs: [{ original: 'Second paragraph', chinese: '第二段' }], has_more: false }),
  ];
  const result = await translateVisualPage('data:image/jpeg;base64,abc', 'secret', {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      limits.push(body.max_tokens);
      return { ok: true, json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: contents.shift() } }],
        usage: { total_tokens: 10 },
      }) };
    }, sleep: async () => {},
  });
  assert.deepEqual(limits, [32000, 64000, 12000, 12000]);
  assert.deepEqual(result.paragraphs.map(item => item.original), ['First paragraph', 'Second paragraph']);
  assert.equal(result.usage.total_tokens, 40);
});
