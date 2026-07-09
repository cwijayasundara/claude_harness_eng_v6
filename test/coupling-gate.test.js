'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { unstableHubKeys, gateDecision } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'coupling-gate.js')
);

function graphWith(hubs) {
  return { metrics: { hubs } };
}

test('unstableHubKeys filters by the drift.js thresholds and sorts', () => {
  const hubs = [
    { id: 'src/god-file.js', fan_in: 9, fan_out: 1, instability: 0.1 },
    { id: 'src/leaf.js', fan_in: 1, fan_out: 9, instability: 0.9 },
    { id: 'src/unstable-b.js', fan_in: 6, fan_out: 20, instability: 0.83 },
    { id: 'src/unstable-a.js', fan_in: 8, fan_out: 30, instability: 0.9 },
  ];
  assert.deepStrictEqual(unstableHubKeys(graphWith(hubs)), [
    'src/unstable-a.js',
    'src/unstable-b.js',
  ]);
});

test('unstableHubKeys handles an empty or missing graph', () => {
  assert.deepStrictEqual(unstableHubKeys({}), []);
  assert.deepStrictEqual(unstableHubKeys(graphWith([])), []);
});

test('gateDecision is the reused cycle-gate ratchet: first run establishes a baseline', () => {
  const d = gateDecision(['a.js', 'b.js'], undefined);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.baselineRun, true);
  assert.strictEqual(d.newBaseline, 2);
});

test('gateDecision blocks when the unstable-hub count increases', () => {
  const d = gateDecision(['a.js', 'b.js', 'c.js'], 2);
  assert.strictEqual(d.count, 3);
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.newBaseline, 2, 'baseline must not move up on a block');
});

test('gateDecision ratchets the baseline down when hubs are fixed', () => {
  const d = gateDecision(['a.js'], 2);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.newBaseline, 1);
});
