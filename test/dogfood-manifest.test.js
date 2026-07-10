'use strict';

// Project Zero dogfood: this harness monorepo carries a root project-manifest
// so agent-readiness / sensor-tier / status can treat it like a real project.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'project-manifest.json');
const TIERS = new Set(['minimal', 'standard', 'strict']);

test('root project-manifest.json exists and is valid JSON', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'project-manifest.json must exist at repo root');
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.strictEqual(typeof m, 'object');
  assert.ok(m !== null);
});

test('Project Zero topology is cli-or-library with architecture disabled', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.strictEqual(m.topology, 'cli-or-library');
  assert.ok(m.architecture && m.architecture.enabled === false,
    'harness plugin code is not a layered product app');
});

test('quality.sensor_tier is a known tier and defaults to standard here', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.ok(m.quality, 'quality block required');
  assert.ok(TIERS.has(m.quality.sensor_tier),
    `sensor_tier must be one of ${[...TIERS].join('|')}, got ${m.quality.sensor_tier}`);
  assert.strictEqual(m.quality.sensor_tier, 'standard');
});

test('quality.agent_readiness is ratchet mode for Project Zero (Phase 2)', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const ar = m.quality.agent_readiness;
  assert.ok(ar, 'quality.agent_readiness required');
  assert.strictEqual(ar.mode, 'ratchet');
  assert.ok(ar.min_active_pillars >= 3);
  assert.strictEqual(ar.forbid_regression, true);
});

test('verification.mode is local (no docker product stack required)', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.strictEqual(m.verification.mode, 'local');
});

test('committed agent-readiness baseline exists under .claude/state/', () => {
  const baseline = path.join(ROOT, '.claude', 'state', 'agent-readiness-baseline.json');
  assert.ok(fs.existsSync(baseline), 'agent-readiness-baseline.json must be committed');
  const b = JSON.parse(fs.readFileSync(baseline, 'utf8'));
  assert.ok(b.summary, 'baseline needs summary');
  assert.ok(Number.isFinite(b.summary.active));
  assert.ok(Array.isArray(b.pillars) && b.pillars.length === 8);
});
