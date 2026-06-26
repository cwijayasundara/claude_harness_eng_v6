'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { openPr } = require('../.claude/scripts/wave-pr.js');

test('openPr is idempotent: returns the existing PR and never creates', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push(args);
    if (args[1] === 'list') return 'https://github.com/o/r/pull/7\n';
    throw new Error('should not have called gh pr create');
  };
  const url = openPr({ branch: 'auto/group-A', base: 'main' }, runner);
  assert.strictEqual(url, 'https://github.com/o/r/pull/7');
  assert.strictEqual(calls.length, 1);
});

test('openPr creates a draft PR with the computed base when none exists', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push(args);
    if (args[1] === 'list') return '\n';
    return 'https://github.com/o/r/pull/8\n';
  };
  const url = openPr({ branch: 'auto/group-B', base: 'auto/group-A', title: 'B', body: 'x' }, runner);
  assert.strictEqual(url, 'https://github.com/o/r/pull/8');
  const create = calls.find((a) => a[1] === 'create');
  assert.ok(create.includes('--draft'));
  assert.strictEqual(create[create.indexOf('--base') + 1], 'auto/group-A');
  assert.strictEqual(create[create.indexOf('--head') + 1], 'auto/group-B');
});

test('openPr requires branch and base', () => {
  assert.throws(() => openPr({ branch: 'auto/group-A' }, () => ''), /base/);
});
