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

const { buildManifest } = require('../.claude/scripts/scaffold-render.js');

test('buildManifest: web-app profile gets the server preset + topology label', () => {
  const m = buildManifest({ projectType: 'A', name: 'shop',
    stack: { backend: { language: 'python', framework: 'FastAPI' }, frontend: { framework: 'react' }, database: { primary: 'postgresql' } } });
  assert.strictEqual(m.topology, 'web-app');
  assert.strictEqual(m.observability.enabled, true);
  assert.strictEqual(m.verification.mode, 'docker');
  assert.strictEqual(m.execution.model_tier, 'cost');
  assert.strictEqual(m.execution.ceremony, 'full');
  assert.strictEqual(m.architecture, undefined); // not-lite: layers.js defaults apply, no key
});

test('buildManifest: backend-only projectType C -> api-service', () => {
  const m = buildManifest({ projectType: 'C', name: 'svc',
    stack: { backend: { language: 'python', framework: 'FastAPI' } } });
  assert.strictEqual(m.topology, 'api-service');
  assert.strictEqual(m.observability.enabled, true);
  assert.strictEqual(m.verification.mode, 'docker');
  assert.strictEqual(m.stack.frontend, null);
});

test('buildManifest: lite projectType D -> cli-or-library, knobs off', () => {
  const m = buildManifest({ projectType: 'D', name: 'tool', stack: { backend: { language: 'python' } } });
  assert.strictEqual(m.topology, 'cli-or-library');
  assert.strictEqual(m.observability.enabled, false);
  assert.deepStrictEqual(m.architecture, { enabled: false });
  assert.strictEqual(m.execution.model_tier, 'cost');
  assert.strictEqual(m.execution.ceremony, 'trimmed');
  assert.strictEqual(m.verification.mode, 'local');
});

test('buildManifest: explicit profile fields still override the preset', () => {
  const m = buildManifest({ projectType: 'D', name: 't', modelTier: 'max-quality', ceremony: 'full',
    stack: { backend: { language: 'python' } } });
  assert.strictEqual(m.execution.model_tier, 'max-quality');
  assert.strictEqual(m.execution.ceremony, 'full');
});

test('G10: topology-templates guide is registered active and wired', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const g = m.guides.find((x) => x.id === 'topology-templates');
  assert.ok(g, 'topology-templates guide must exist');
  assert.strictEqual(g.status, 'active');
  assert.strictEqual(g.gap_ref, 'G10');
  assert.ok(g.wired_at && fs.existsSync(path.join(ROOT, g.wired_at)), 'wired_at must resolve');
});

test('G10: scaffold.md surfaces the detected topology', () => {
  assert.ok(/topology/i.test(read('.claude/commands/scaffold.md')), 'scaffold.md must mention topology');
});
