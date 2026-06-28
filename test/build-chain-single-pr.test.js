'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { promptFor } = require('../.claude/scripts/build-chain.js');

test('promptFor forwards --single-pr to every link kind', () => {
  assert.ok(promptFor('PLAN', 'prd.md', { singlePr: true }).includes('--single-pr'));
  assert.ok(promptFor('FINALIZE', 'prd.md', { singlePr: true }).includes('--single-pr'));
  assert.ok(promptFor('BUILD', 'prd.md', { singlePr: true }).includes('--single-pr'));
});

test('promptFor omits --single-pr by default', () => {
  assert.ok(!promptFor('BUILD', 'prd.md', {}).includes('--single-pr'));
  assert.ok(!promptFor('PLAN', 'prd.md', {}).includes('--single-pr'));
});

test('promptFor still appends --sequential for BUILD links', () => {
  const p = promptFor('BUILD', 'prd.md', { sequential: true, singlePr: true });
  assert.ok(p.includes('--sequential') && p.includes('--single-pr'));
});

test('promptFor forwards --auto-merge to FINALIZE only', () => {
  assert.ok(promptFor('FINALIZE', 'prd.md', { autoMerge: true }).includes('--auto-merge'));
  assert.ok(!promptFor('PLAN', 'prd.md', { autoMerge: true }).includes('--auto-merge'));
  assert.ok(!promptFor('BUILD', 'prd.md', { autoMerge: true }).includes('--auto-merge'));
});

test('promptFor omits --auto-merge by default', () => {
  assert.ok(!promptFor('FINALIZE', 'prd.md', {}).includes('--auto-merge'));
});

test('FINALIZE can carry both --single-pr and --auto-merge', () => {
  const p = promptFor('FINALIZE', 'prd.md', { singlePr: true, autoMerge: true });
  assert.ok(p.includes('--single-pr') && p.includes('--auto-merge'));
});
