'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enableAutoMerge, isRealPrUrl } = require('./pr');

test('isRealPrUrl requires a canonical PR url', () => {
  assert.equal(isRealPrUrl('https://github.com/o/r/pull/12'), true);
  for (const bad of [null, 'https://example.com/foo', 'https://github.com/o/r/issues/3', '--auto', 'not a url']) {
    assert.equal(isRealPrUrl(bad), false, `should reject ${bad}`);
  }
});

test('enableAutoMerge refuses without a real PR url (no gh call)', async () => {
  const r = await enableAutoMerge(null, '/tmp', { autoMerge: { method: 'merge' } });
  assert.equal(r.enabled, false);
  assert.match(r.reason, /no PR/i);
});

test('enableAutoMerge refuses non-PR urls (no gh call)', async () => {
  for (const bad of ['https://example.com/foo', 'https://github.com/o/r/issues/3']) {
    const r = await enableAutoMerge(bad, '/tmp', { autoMerge: { method: 'merge' } });
    assert.equal(r.enabled, false, `should refuse ${bad}`);
  }
});
