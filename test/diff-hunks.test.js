'use strict';

// Gap G29 Gap A: pure hunk-range parsing for `git diff --cached -U0` output,
// used by legacy-discipline-gate.js to know WHICH LINES a staged diff
// actually touched (see that file's header for why this was written new
// rather than reused — no existing hunk parser was found in the repo).

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { parseUnifiedDiffRanges } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'diff-hunks')
);

test('a single-hunk addition reports the new-side [start,end] range', () => {
  const diff = 'diff --git a/src/a.py b/src/a.py\n+++ b/src/a.py\n@@ -10,0 +11,3 @@\n+x\n+y\n+z\n';
  const ranges = parseUnifiedDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/a.py'), [[11, 13]]);
});

test('a single-line hunk (omitted count defaults to 1)', () => {
  const diff = 'diff --git a/src/a.py b/src/a.py\n+++ b/src/a.py\n@@ -5 +5 @@\n-old\n+new\n';
  const ranges = parseUnifiedDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/a.py'), [[5, 5]]);
});

test('a pure-deletion hunk (new count 0) is a single-point range, not empty', () => {
  const diff = 'diff --git a/src/a.py b/src/a.py\n+++ b/src/a.py\n@@ -20,3 +20,0 @@\n-a\n-b\n-c\n';
  const ranges = parseUnifiedDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/a.py'), [[20, 20]]);
});

test('a deletion at the very start of the file (new start 0) clamps to line 1', () => {
  const diff = 'diff --git a/src/a.py b/src/a.py\n+++ b/src/a.py\n@@ -1,2 +0,0 @@\n-a\n-b\n';
  const ranges = parseUnifiedDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/a.py'), [[1, 1]]);
});

test('multiple files each get their own range list, in order', () => {
  const diff = [
    'diff --git a/src/a.py b/src/a.py',
    '+++ b/src/a.py',
    '@@ -1,0 +2,1 @@',
    '+x',
    'diff --git a/src/b.py b/src/b.py',
    '+++ b/src/b.py',
    '@@ -9,0 +10,2 @@',
    '+y',
    '+z',
  ].join('\n');
  const ranges = parseUnifiedDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/a.py'), [[2, 2]]);
  assert.deepStrictEqual(ranges.get('src/b.py'), [[10, 11]]);
});

test('multiple hunks in the same file are all collected', () => {
  const diff = [
    'diff --git a/src/a.py b/src/a.py',
    '+++ b/src/a.py',
    '@@ -1,0 +2,1 @@',
    '+x',
    '@@ -40,0 +42,2 @@',
    '+y',
    '+z',
  ].join('\n');
  const ranges = parseUnifiedDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/a.py'), [[2, 2], [42, 43]]);
});

test('a deleted file (+++ /dev/null) contributes no ranges', () => {
  const diff = 'diff --git a/src/gone.py b/src/gone.py\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n-b\n-c\n';
  const ranges = parseUnifiedDiffRanges(diff);
  assert.strictEqual(ranges.size, 0);
});

test('empty or garbage input parses to an empty Map, never throws', () => {
  assert.strictEqual(parseUnifiedDiffRanges('').size, 0);
  assert.strictEqual(parseUnifiedDiffRanges('not a diff at all\njust text\n').size, 0);
  assert.strictEqual(parseUnifiedDiffRanges(null).size, 0);
});
