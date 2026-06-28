'use strict';

// Contract for gap G10: per-topology harness templates. /scaffold resolves a
// named topology and presets a coherent bundle of existing manifest knobs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { resolveTopology, topologyPreset, TOPOLOGIES } = require('../.claude/scripts/topologies.js');

test('resolveTopology: lite -> cli-or-library', () => {
  assert.strictEqual(resolveTopology({ stack: { frontend: { framework: 'react' } } }, true), 'cli-or-library');
});

test('resolveTopology: not-lite with a frontend -> web-app', () => {
  assert.strictEqual(resolveTopology({ stack: { backend: {}, frontend: { framework: 'react' } } }, false), 'web-app');
});

test('resolveTopology: not-lite, no frontend -> api-service', () => {
  assert.strictEqual(resolveTopology({ stack: { backend: { framework: 'FastAPI' } } }, false), 'api-service');
});

test('topologyPreset: server topologies enable observability, lite disables it', () => {
  assert.strictEqual(topologyPreset('web-app').observability_enabled, true);
  assert.strictEqual(topologyPreset('api-service').observability_enabled, true);
  assert.strictEqual(topologyPreset('cli-or-library').observability_enabled, false);
});

test('topologyPreset: only cli-or-library sets an architecture override', () => {
  assert.strictEqual(topologyPreset('web-app').architecture, undefined);
  assert.deepStrictEqual(topologyPreset('cli-or-library').architecture, { enabled: false });
});

test('topologyPreset: unknown id throws (loud failure)', () => {
  assert.throws(() => topologyPreset('crud-on-jvm'), /Unknown topology/);
});

test('TOPOLOGIES has exactly the three supported topologies', () => {
  assert.deepStrictEqual(Object.keys(TOPOLOGIES).sort(), ['api-service', 'cli-or-library', 'web-app']);
});
