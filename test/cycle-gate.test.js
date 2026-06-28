'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { cycleKeys, gateDecision } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'cycle-gate.js')
);

function graphWith(cycles) {
  return { metrics: { cycles } };
}

test('cycleKeys canonicalizes cycles order-independently', () => {
  assert.deepStrictEqual(cycleKeys(graphWith([['b', 'a'], ['d', 'c']])), ['a -> b', 'c -> d']);
  assert.deepStrictEqual(cycleKeys({}), []);
});

test('first run establishes the baseline without blocking', () => {
  const d = gateDecision(['a -> b', 'c -> d'], undefined);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.baselineRun, true);
  assert.strictEqual(d.newBaseline, 2);
});

test('adding a cycle blocks; the baseline is not advanced', () => {
  const d = gateDecision(['a -> b', 'c -> d', 'e -> f'], 2);
  assert.strictEqual(d.count, 3);
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.newBaseline, 2, 'baseline must not move up on a block');
});

test('removing a cycle ratchets the baseline down', () => {
  const d = gateDecision(['a -> b'], 2);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.newBaseline, 1, 'ratchet only goes down');
});

test('staying equal passes and holds the baseline', () => {
  const d = gateDecision(['a -> b', 'c -> d'], 2);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.newBaseline, 2);
});
