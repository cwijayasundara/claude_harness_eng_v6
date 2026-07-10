'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  VALID_TIERS,
  loadSensorTier,
  isGateEnabled,
  normalizeTier,
  GATE_TIERS,
} = require('../.claude/hooks/lib/sensor-tier');

test('VALID_TIERS are minimal, standard, strict', () => {
  assert.deepStrictEqual([...VALID_TIERS], ['minimal', 'standard', 'strict']);
});

test('normalizeTier rejects garbage', () => {
  assert.strictEqual(normalizeTier('nope'), null);
  assert.strictEqual(normalizeTier('STANDARD'), 'standard');
});

test('loadSensorTier defaults to standard without manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-'));
  assert.strictEqual(loadSensorTier(dir, {}), 'standard');
});

test('loadSensorTier reads project-manifest.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    quality: { sensor_tier: 'minimal' },
  }));
  assert.strictEqual(loadSensorTier(dir, {}), 'minimal');
});

test('HARNESS_SENSOR_TIER env wins over manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    quality: { sensor_tier: 'strict' },
  }));
  assert.strictEqual(loadSensorTier(dir, { HARNESS_SENSOR_TIER: 'minimal' }), 'minimal');
});

test('standard enables sprout and legacy; minimal does not', () => {
  assert.strictEqual(isGateEnabled('standard', 'sprout-diff'), true);
  assert.strictEqual(isGateEnabled('standard', 'legacy-discipline-proof'), true);
  assert.strictEqual(isGateEnabled('minimal', 'sprout-diff'), false);
  assert.strictEqual(isGateEnabled('minimal', 'legacy-discipline-proof'), false);
  assert.strictEqual(isGateEnabled('minimal', 'secret-scan'), true);
});

test('strict enables cycle and coupling; standard does not', () => {
  assert.strictEqual(isGateEnabled('strict', 'cycle-detection'), true);
  assert.strictEqual(isGateEnabled('strict', 'coupling-ratchet'), true);
  assert.strictEqual(isGateEnabled('standard', 'cycle-detection'), false);
  assert.strictEqual(isGateEnabled('standard', 'coupling-ratchet'), false);
});

test('GATE_TIERS covers all catalog-critical ids', () => {
  for (const id of [
    'secret-scan', 'test-deletion-guard', 'mutation-smoke', 'sprout-diff',
    'cycle-detection', 'coupling-ratchet',
  ]) {
    assert.ok(GATE_TIERS[id], `missing GATE_TIERS entry for ${id}`);
  }
});
