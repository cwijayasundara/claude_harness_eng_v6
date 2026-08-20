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
  isBrownfieldGraphReal,
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

test('mutation-smoke runs on standard and strict, not minimal', () => {
  assert.strictEqual(isGateEnabled('standard', 'mutation-smoke'), true);
  assert.strictEqual(isGateEnabled('minimal', 'mutation-smoke'), false);
  assert.strictEqual(isGateEnabled('strict', 'mutation-smoke'), true);
});

test('unknown gate ids require an explicit GATE_TIERS row', () => {
  assert.strictEqual(isGateEnabled('standard', 'brand-new-undocumented-gate'), false);
  assert.strictEqual(isGateEnabled('strict', 'brand-new-undocumented-gate'), false);
});

test('isBrownfieldGraphReal is false for a placeholder and true for a real graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-graph-'));
  const brown = path.join(dir, 'specs', 'brownfield');
  fs.mkdirSync(brown, { recursive: true });
  assert.strictEqual(isBrownfieldGraphReal(dir), false);
  fs.writeFileSync(path.join(brown, 'code-graph.meta.json'), JSON.stringify({
    producer: 'none', status: 'empty',
  }));
  assert.strictEqual(isBrownfieldGraphReal(dir), false);
  fs.writeFileSync(path.join(brown, 'code-graph.meta.json'), JSON.stringify({
    producer: 'vendored-ast', status: 'fresh',
  }));
  assert.strictEqual(isBrownfieldGraphReal(dir), true);
});

test('GATE_TIERS covers all catalog-critical ids', () => {
  for (const id of [
    'secret-scan', 'test-deletion-guard', 'mutation-smoke', 'sprout-diff',
    'cycle-detection', 'coupling-ratchet',
  ]) {
    assert.ok(GATE_TIERS[id], `missing GATE_TIERS entry for ${id}`);
  }
});
