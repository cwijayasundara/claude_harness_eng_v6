'use strict';

// Fleet-retrofit runner — pure classification/aggregation (design tests 1, 2, 4, 5).
// classifyGate / rollupRepo / summarize / buildReport exercised directly over the
// provisioner exit codes, no gh or filesystem.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { SCRIPTS, NOW } = require('./fleet-retrofit-helpers');
const core = require(path.join(SCRIPTS, 'fleet-retrofit-core'));

// ============================ 1. classifyGate ================================

test('1a: audit mode classifies a gate from its verify code alone', () => {
  assert.strictEqual(core.classifyGate('protection', 'audit', null, 0), 'gated');
  assert.strictEqual(core.classifyGate('protection', 'audit', null, 1), 'drifted');
  assert.strictEqual(core.classifyGate('protection', 'audit', null, 2), 'failed');
  assert.strictEqual(core.classifyGate('env', 'audit', null, 0), 'gated');
  assert.strictEqual(core.classifyGate('env', 'audit', null, 1), 'drifted');
  assert.strictEqual(core.classifyGate('env', 'audit', null, 2), 'failed');
});

test('1b: an unexpected verify code is fail-safe (failed), never gated', () => {
  assert.strictEqual(core.classifyGate('protection', 'audit', null, 7), 'failed');
});

// ============================ 2. apply-mode codes ============================

test('2a: apply failure (code 2) is failed regardless of a later verify', () => {
  assert.strictEqual(core.classifyGate('protection', 'apply', 2, 0), 'failed');
  assert.strictEqual(core.classifyGate('env', 'apply', 2, 0), 'failed');
});

test('2b: env apply code 3 (empty reviewers) is not-gating, never gated', () => {
  assert.strictEqual(core.classifyGate('env', 'apply', 3, 1), 'not-gating');
  // code 3 is env-only; protection never emits it, so fall through to verify.
  assert.strictEqual(core.classifyGate('protection', 'apply', 3, 0), 'gated');
});

test('2c: apply ok (0) then verify decides', () => {
  assert.strictEqual(core.classifyGate('protection', 'apply', 0, 0), 'gated');
  assert.strictEqual(core.classifyGate('env', 'apply', 0, 1), 'drifted');
});

// ============================ 3. rollupRepo =================================

test('3: a repo is gated iff BOTH gates are gated; else worst gate wins', () => {
  assert.strictEqual(core.rollupRepo('gated', 'gated'), 'gated');
  assert.strictEqual(core.rollupRepo('gated', 'drifted'), 'drifted');
  assert.strictEqual(core.rollupRepo('gated', 'not-gating'), 'not-gating');
  assert.strictEqual(core.rollupRepo('drifted', 'not-gating'), 'not-gating');
  assert.strictEqual(core.rollupRepo('failed', 'gated'), 'failed');
  assert.strictEqual(core.rollupRepo('not-gating', 'failed'), 'failed');
});

// ============================ 4. summarize + fleet_gated ====================

test('4a: summarize counts each repo status; buildReport fleet_gated is fail-safe', () => {
  const rows = [
    { repo: 'acme/a', branch_protection: 'gated', deploy_gate: 'gated', status: 'gated' },
    { repo: 'acme/b', branch_protection: 'gated', deploy_gate: 'drifted', status: 'drifted' },
    { repo: 'acme/c', branch_protection: 'failed', deploy_gate: 'failed', status: 'failed' },
    { repo: 'acme/d', branch_protection: 'gated', deploy_gate: 'not-gating', status: 'not-gating' },
  ];
  const report = core.buildReport({ rows, mode: 'audit', now: NOW });
  assert.deepStrictEqual(report.summary, { total: 4, gated: 1, drifted: 1, not_gating: 1, failed: 1 });
  assert.strictEqual(report.fleet_gated, false);
  assert.strictEqual(report.mode, 'audit');
  assert.strictEqual(report.generated_at, NOW);
});

test('4b: an all-gated fleet is fleet_gated:true', () => {
  const rows = [
    { repo: 'acme/a', branch_protection: 'gated', deploy_gate: 'gated', status: 'gated' },
    { repo: 'acme/b', branch_protection: 'gated', deploy_gate: 'gated', status: 'gated' },
  ];
  const report = core.buildReport({ rows, mode: 'apply', now: NOW });
  assert.strictEqual(report.fleet_gated, true);
  assert.strictEqual(report.summary.gated, 2);
});

test('4c: an empty fleet is NOT a green (fail-safe)', () => {
  const report = core.buildReport({ rows: [], mode: 'audit', now: NOW });
  assert.strictEqual(report.summary.total, 0);
  assert.strictEqual(report.fleet_gated, false);
});
