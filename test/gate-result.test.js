'use strict';

const assert = require('assert');
const { test } = require('node:test');
const {
  formatBlock,
  formatSkip,
  ensureTierFooter,
} = require('../.claude/hooks/lib/gate-result');

test('formatBlock includes Fix, Waive, Tier', () => {
  const msg = formatBlock({
    id: 'cycle-detection',
    title: 'import cycles increased 0 -> 1',
    detail: '  - a -> b\n',
    fix: 'break the cycle.',
    envOff: 'HARNESS_CYCLE_GATE',
    tier: 'strict',
    minTier: 'strict',
  });
  assert.match(msg, /BLOCKED \[cycle-detection\]:/);
  assert.match(msg, /Fix: break the cycle/);
  assert.match(msg, /Waive:.*HARNESS_CYCLE_GATE=off/);
  assert.match(msg, /Tier:.*strict/);
});

test('formatBlock does not duplicate Fix if already in detail', () => {
  const msg = formatBlock({
    title: 'x',
    detail: 'body\nFix: already here\n',
    fix: 'should not appear twice',
  });
  assert.strictEqual((msg.match(/Fix:/g) || []).length, 1);
});

test('ensureTierFooter appends only when missing', () => {
  const a = ensureTierFooter('BLOCKED: x\nFix: y\n', 'standard');
  assert.match(a, /Tier: active sensor_tier="standard"/);
  const b = ensureTierFooter('BLOCKED: x\nTier: already\n', 'standard');
  assert.strictEqual((b.match(/Tier:/g) || []).length, 1);
});

test('formatSkip includes Fix and optional Tier', () => {
  const msg = formatSkip('ownership', 'HARNESS_OWNERSHIP_GATE=off', 'minimal');
  assert.match(msg, /GATE SKIPPED/);
  assert.match(msg, /Fix:/);
  assert.match(msg, /Tier:.*minimal/);
});
