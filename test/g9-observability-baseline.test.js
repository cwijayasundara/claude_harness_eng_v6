'use strict';

// Contract for gap G9: app-level observability baseline (guide-only).
// The harness scaffolds a RED-metrics + /metrics + log-correlation baseline
// into generated server apps via a feedforward code-gen guide, defaulted on
// for server shapes with deterministic manifest + deploy anchors.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { buildManifest } = require('../.claude/scripts/scaffold-render.js');

test('G9: buildManifest defaults observability on for a server shape', () => {
  const m = buildManifest({
    name: 'api', projectType: 'C',
    stack: { backend: { language: 'python', framework: 'FastAPI' }, database: { engine: 'postgres' } },
  });
  assert.ok(m.observability, 'manifest must carry an observability block');
  assert.strictEqual(m.observability.enabled, true);
  assert.strictEqual(m.observability.metrics_path, '/metrics');
  assert.deepStrictEqual(m.observability.red_labels, ['method', 'route', 'status']);
  assert.strictEqual(typeof m.observability.slo.error_rate_pct, 'number');
  assert.strictEqual(typeof m.observability.slo.p95_ms, 'number');
});

test('G9: buildManifest defaults observability off for a lite (CLI/library) shape', () => {
  const m = buildManifest({ name: 'tool', projectType: 'D', stack: { backend: { language: 'python' } } });
  assert.ok(m.observability, 'observability block present even when disabled');
  assert.strictEqual(m.observability.enabled, false);
});
