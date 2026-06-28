'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'slo-check.js');

// Build a temp project root with a manifest + a /metrics fixture, run the CLI
// against it with --fixture (no socket), and return {code, verdict}.
function runSlo(manifestObs, metricsText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'),
    JSON.stringify({ observability: manifestObs }));
  const fixture = path.join(dir, 'metrics.txt');
  fs.writeFileSync(fixture, metricsText);
  let code = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', dir, '--fixture', fixture], { stdio: 'pipe' });
  } catch (e) { code = e.status; }
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'slo-verdict.json'), 'utf8'));
  return { code, verdict };
}

const OK = 'http_requests_total{status="200"} 100\n';
const ERRORS = 'http_requests_total{status="200"} 90\nhttp_requests_total{status="500"} 10\n';

test('disabled observability -> exit 0, verdict disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'),
    JSON.stringify({ observability: { enabled: false } }));
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'slo-verdict.json'), 'utf8'));
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'disabled');
});

test('error-rate over budget -> exit 1 (FAIL)', () => {
  const { code, verdict } = runSlo({ enabled: true, slo: { error_rate_pct: 1.0, p95_ms: 500 } }, ERRORS);
  assert.strictEqual(code, 1);
  assert.strictEqual(verdict.verdict, 'fail');
  assert.ok(verdict.breaches.includes('error_rate'));
  assert.strictEqual(verdict.error_rate_pct, 10);
});

test('within budget -> exit 0 (pass)', () => {
  const { code, verdict } = runSlo({ enabled: true, slo: { error_rate_pct: 1.0, p95_ms: 500 } }, OK);
  assert.strictEqual(code, 0);
  assert.strictEqual(verdict.verdict, 'pass');
});

test('p95-only breach -> exit 2 (WARN)', () => {
  const HIGH_LATENCY = [
    'http_requests_total{method="GET",route="/x",status="200"} 100',
    'http_request_duration_seconds_bucket{method="GET",route="/x",le="0.1"} 0',
    'http_request_duration_seconds_bucket{method="GET",route="/x",le="0.5"} 0',
    'http_request_duration_seconds_bucket{method="GET",route="/x",le="1.0"} 0',
    'http_request_duration_seconds_bucket{method="GET",route="/x",le="+Inf"} 100',
    'http_request_duration_seconds_count{method="GET",route="/x"} 100',
  ].join('\n') + '\n';
  const { code, verdict } = runSlo({ enabled: true, slo: { error_rate_pct: 1.0, p95_ms: 500 } }, HIGH_LATENCY);
  assert.strictEqual(code, 2);
  assert.strictEqual(verdict.verdict, 'warn');
  assert.ok(verdict.breaches.includes('p95'));
  assert.ok(!verdict.breaches.includes('error_rate'));
});

test('no traffic -> exit 2 (WARN)', () => {
  const { code, verdict } = runSlo({ enabled: true, slo: { error_rate_pct: 1.0, p95_ms: 500 } }, '# no metrics yet\n');
  assert.strictEqual(code, 2);
  assert.strictEqual(verdict.verdict, 'warn');
});

// Wiring assertions (Task 3 / G9)
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G9: evaluate documents the SLO step P4 and slo failure_layer', () => {
  const e = rd('.claude/skills/evaluate/SKILL.md');
  assert.ok(/slo-check\.js/.test(e), 'evaluate must invoke slo-check.js');
  assert.ok(/failure_layer:\s*"?slo"?/.test(e), 'evaluate must define the slo failure layer');
  const ev = rd('.claude/agents/evaluator.md');
  assert.ok(/slo/i.test(ev) && /error-rate|error_rate/i.test(ev),
    'evaluator KEY RULES must mention the SLO error-rate gate');
});

test('G9: slo npm script is wired', () => {
  const pkg = JSON.parse(rd('package.json'));
  assert.strictEqual(pkg.scripts.slo, 'node .claude/scripts/slo-check.js');
});
