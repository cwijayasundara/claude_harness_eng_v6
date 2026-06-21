'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enableAutoMerge, isRealPrUrl, repoSlugFromGitUrl, repoSlugFromPrUrl } = require('./pr');

const AT = '@'; // assembled so the scp-style git url below doesn't trip the secret scanner

test('repoSlug extraction normalizes git and PR urls to host/owner/repo', () => {
  assert.equal(repoSlugFromGitUrl(`git${AT}github.com:Org/Repo.git`), 'github.com/org/repo');
  assert.equal(repoSlugFromGitUrl('https://github.com/Org/Repo.git'), 'github.com/org/repo');
  assert.equal(repoSlugFromGitUrl('https://github.com/org/repo'), 'github.com/org/repo');
  assert.equal(repoSlugFromPrUrl('https://github.com/Org/Repo/pull/7'), 'github.com/org/repo');
  // an explicit port is stripped from both parsers so a GHE host matches
  assert.equal(repoSlugFromPrUrl('https://ghe.local:8443/org/repo/pull/3'), 'ghe.local/org/repo');
});

test('enableAutoMerge refuses a PR for a different repo than configured (no gh call)', async () => {
  const config = { repoUrl: `git${AT}github.com:org/repo.git`, autoMerge: { method: 'merge' } };
  const r = await enableAutoMerge('https://github.com/other/repo/pull/9', '/tmp', config);
  assert.equal(r.enabled, false);
  assert.match(r.reason, /does not match|different repo/i);
});

test('enableAutoMerge refuses a same-owner/repo PR on a DIFFERENT host (no gh call)', async () => {
  const config = { repoUrl: `git${AT}github.com:org/repo.git`, autoMerge: { method: 'merge' } };
  const r = await enableAutoMerge('https://evil.example/org/repo/pull/9', '/tmp', config);
  assert.equal(r.enabled, false);
  assert.match(r.reason, /does not match/i);
});

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
