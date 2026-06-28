'use strict';

const assert = require('assert');
const { test } = require('node:test');

const {
  isAutoMergeEnabled, resolveMethod, enableAutoMerge,
  isRealPrUrl, repoSlugFromGitUrl, repoSlugFromPrUrl,
} = require('../.claude/scripts/auto-merge.js');

test('isAutoMergeEnabled: flag, env, neither, both', () => {
  assert.strictEqual(isAutoMergeEnabled(['--auto-merge'], {}), true);
  assert.strictEqual(isAutoMergeEnabled([], { AUTO_MERGE: 'true' }), true);
  assert.strictEqual(isAutoMergeEnabled(['--auto-merge'], { AUTO_MERGE: 'true' }), true);
  assert.strictEqual(isAutoMergeEnabled([], {}), false);
  assert.strictEqual(isAutoMergeEnabled([], { AUTO_MERGE: 'false' }), false);
});

test('resolveMethod: default merge, valid values, invalid throws', () => {
  assert.strictEqual(resolveMethod({}), 'merge');
  assert.strictEqual(resolveMethod({ MERGE_METHOD: 'squash' }), 'squash');
  assert.strictEqual(resolveMethod({ MERGE_METHOD: 'REBASE' }), 'rebase');
  assert.throws(() => resolveMethod({ MERGE_METHOD: 'fast-forward' }), /merge, squash, rebase/);
});

test('repo slug helpers (scp + https)', () => {
  assert.strictEqual(repoSlugFromGitUrl('git@github.com:Owner/Repo.git'), 'github.com/owner/repo');
  assert.strictEqual(repoSlugFromGitUrl('https://github.com/Owner/Repo'), 'github.com/owner/repo');
  assert.strictEqual(repoSlugFromPrUrl('https://github.com/owner/repo/pull/7'), 'github.com/owner/repo');
});

test('enableAutoMerge: non-PR url is not enabled and makes no gh call', () => {
  const calls = [];
  const r = enableAutoMerge('not-a-pr', { runner: (c, a) => { calls.push(a); } });
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(calls.length, 0);
});

test('enableAutoMerge: slug mismatch refuses, no gh call', () => {
  const calls = [];
  const r = enableAutoMerge('https://github.com/owner/other/pull/3', {
    runner: (c, a) => { calls.push(a); }, expectedSlug: 'github.com/owner/repo',
  });
  assert.strictEqual(r.enabled, false);
  assert.match(r.reason, /does not match/);
  assert.strictEqual(calls.length, 0);
});

test('enableAutoMerge: happy path calls gh pr merge --auto --<method>', () => {
  const calls = [];
  const r = enableAutoMerge('https://github.com/owner/repo/pull/9', {
    runner: (c, a) => { calls.push([c, a]); return ''; },
    expectedSlug: 'github.com/owner/repo', method: 'squash',
  });
  assert.strictEqual(r.enabled, true);
  assert.deepStrictEqual(calls[0], ['gh', ['pr', 'merge', '--auto', '--squash', '--', 'https://github.com/owner/repo/pull/9']]);
});

test('enableAutoMerge: runner error falls back to not-enabled (no throw)', () => {
  const r = enableAutoMerge('https://github.com/owner/repo/pull/9', {
    runner: () => { throw new Error('auto-merge not allowed on this repo'); },
    expectedSlug: 'github.com/owner/repo',
  });
  assert.strictEqual(r.enabled, false);
  assert.match(r.reason, /not allowed/);
});
