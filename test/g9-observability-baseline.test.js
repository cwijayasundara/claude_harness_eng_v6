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

const CONV = '.claude/skills/code-gen/references/observability-conventions.md';
const FASTAPI = '.claude/skills/code-gen/references/observability-python-fastapi.md';

test('G9: stack-neutral observability conventions reference documents the contract', () => {
  const c = read(CONV);
  assert.ok(/http_requests_total/.test(c) && /http_request_duration_seconds/.test(c),
    'must name the two RED metrics');
  assert.ok(/\/metrics/.test(c), 'must document the /metrics endpoint');
  assert.ok(/route template/i.test(c) && /cardinalit/i.test(c),
    'must state the route-template cardinality guardrail');
  assert.ok(/observability\.enabled/.test(c), 'must document the opt-out');
  assert.ok(/trace_id|request_id/.test(c), 'must require log correlation');
});

test('G9: FastAPI observability reference carries a concrete implementation', () => {
  const f = read(FASTAPI);
  assert.ok(/prometheus[_-]client/.test(f), 'must name the prometheus-client dependency');
  assert.ok(/generate_latest/.test(f) && /CONTENT_TYPE_LATEST/.test(f),
    'must show the /metrics response');
  assert.ok(/Middleware/.test(f), 'must show the request middleware');
  assert.ok(/ContextVar|contextvars/.test(f), 'must show the contextvar log correlation');
  assert.ok(/route\.matches/.test(f) && /Match\.FULL/.test(f),
    'route template must be captured by re-matching app.routes (Match.FULL), not scope["route"]');
  assert.ok(!/scope\.get\(['"]route['"]\)/.test(f),
    'must not rely on scope["route"] (unset under BaseHTTPMiddleware)');
});

test('G9: generator is triggered to read the observability references', () => {
  const g = read('.claude/agents/generator.md');
  assert.ok(/observability-conventions\.md/.test(g), 'generator must point at the conventions reference');
  assert.ok(/observability\.enabled/.test(g), 'trigger must be gated on observability.enabled');
});

test('G9: deploy wires Prometheus scrape discovery when observability is enabled', () => {
  const d = read('.claude/skills/deploy/SKILL.md');
  assert.ok(/prometheus\.io\/scrape/.test(d), 'must document the scrape annotation');
  assert.ok(/observability\.enabled/.test(d), 'scrape wiring must be gated on observability.enabled');
  assert.ok(/metrics_path/.test(d), 'must point the scrape at the configured metrics_path');
});

test('G9: observability-conventions guide is active and wired in the manifest', () => {
  const manifest = JSON.parse(read('harness-manifest.json'));
  const guide = manifest.guides.find((g) => g.id === 'observability-conventions');
  assert.ok(guide, 'observability-conventions guide must exist');
  assert.strictEqual(guide.status, 'active');
  assert.strictEqual(guide.gap_ref, 'G9');
  assert.ok(guide.wired_at && fs.existsSync(path.join(ROOT, guide.wired_at)),
    'wired_at must resolve on disk');
});
