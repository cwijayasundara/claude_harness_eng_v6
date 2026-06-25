'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { parseBuildInvocation } = require('../.claude/scripts/build-lane.js');

test('full auto and lite flags are order-independent', () => {
  const a = parseBuildInvocation('/build --auto --lite docs/prd.md');
  const b = parseBuildInvocation('/build --lite docs/prd.md --auto');

  assert.strictEqual(a.lane, 'lite-auto');
  assert.deepStrictEqual(b, a);
  assert.strictEqual(a.prdPath, 'docs/prd.md');
  assert.strictEqual(a.humanGates, 0);
  assert.strictEqual(a.requiresPrd, true);
});

test('gated build keeps the per-phase human gates', () => {
  const r = parseBuildInvocation('/build docs/prd.md');

  assert.strictEqual(r.lane, 'gated');
  assert.strictEqual(r.prdPath, 'docs/prd.md');
  assert.strictEqual(r.humanGates, 3);
  assert.strictEqual(r.auto, false);
});

test('autonomous build has one consolidated approval gate', () => {
  const r = parseBuildInvocation('/build docs/prd.md --autonomous --mode lean --pod 3');

  assert.strictEqual(r.lane, 'autonomous');
  assert.strictEqual(r.mode, 'lean');
  assert.strictEqual(r.pod, 3);
  assert.strictEqual(r.humanGates, 1);
});

test('full auto requires a PRD path', () => {
  const r = parseBuildInvocation('/build --auto');

  assert.strictEqual(r.valid, false);
  assert.match(r.error, /PRD/i);
});

test('finalize is an explicit terminal lane', () => {
  const r = parseBuildInvocation('/build --auto --finalize');

  assert.strictEqual(r.lane, 'finalize');
  assert.strictEqual(r.humanGates, 0);
  assert.strictEqual(r.requiresPrd, false);
});
