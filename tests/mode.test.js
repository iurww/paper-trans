import test from 'node:test';
import assert from 'node:assert/strict';
import { hasModeResult } from '../src/app/mode.js';

test('mode switching requires the target translation result', () => {
  const record = { original: new Blob(), mode: 'visual', status: 'visual', visualStatus: 'working',
    visualPageCount: 2, visualPages: [{ number: 1, paragraphs: [] }] };
  assert.equal(hasModeResult(record, 'visual'), false);
  assert.equal(hasModeResult(record, 'standard'), false);
  record.visualPageCount = 1;
  assert.equal(hasModeResult(record, 'visual'), true);
  record.visualStatus = 'done';
  assert.equal(hasModeResult(record, 'visual'), true);
  record.translated = new Blob();
  record.pages = [{ number: 1 }];
  assert.equal(hasModeResult(record, 'standard'), true);
});
