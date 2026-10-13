import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from '../src/translation/translation-api.js';

test('default platform transport sends translation requests and handles HTTP retries', async () => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) });
    if (received.length === 1) {
      res.writeHead(429, { 'retry-after': '0' });
      res.end('retry');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"translation":"你好"}' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const messages = [{ role: 'user', content: 'Hello' }];
    const result = await request(messages, {
      endpoint: `http://127.0.0.1:${server.address().port}/chat/completions`, model: 'test-model', key: 'test-key',
    }, undefined, async () => {});
    assert.equal(received.length, 2);
    assert.equal(received[1].method, 'POST');
    assert.equal(received[1].authorization, 'Bearer test-key');
    assert.deepEqual(received[1].body.messages, messages);
    assert.equal(received[1].body.model, 'test-model');
    assert.equal(result.choices[0].message.content, '{"translation":"你好"}');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
