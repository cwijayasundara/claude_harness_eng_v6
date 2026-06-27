'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { parseFeatureInvocation } = require('../.claude/scripts/feature-lane.js');

test('default lane has the three interactive gates', () => {
  const r = parseFeatureInvocation('/feature "add confidence scores"');
  assert.strictEqual(r.lane, 'gated');
  assert.strictEqual(r.humanGates, 3);
  assert.strictEqual(r.request, 'add confidence scores');
});

test('--autonomous is one gate', () => {
  const r = parseFeatureInvocation('/feature "split billing" --autonomous');
  assert.strictEqual(r.lane, 'autonomous');
  assert.strictEqual(r.humanGates, 1);
  assert.strictEqual(r.autonomous, true);
});

test('--auto is zero gates and implies the autonomous tail', () => {
  const r = parseFeatureInvocation('/feature --auto "add a health endpoint"');
  assert.strictEqual(r.lane, 'auto');
  assert.strictEqual(r.humanGates, 0);
  assert.strictEqual(r.auto, true);
  assert.strictEqual(r.autonomous, true);
  assert.strictEqual(r.request, 'add a health endpoint');
});

test('flags are order-independent and stripped from the request', () => {
  const a = parseFeatureInvocation('/feature --auto "do the thing"');
  const b = parseFeatureInvocation('/feature "do the thing" --auto');
  assert.deepStrictEqual(b, a);
  assert.strictEqual(a.request, 'do the thing');
});

test('a missing request is invalid', () => {
  const r = parseFeatureInvocation('/feature --auto');
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /request/i);
});
