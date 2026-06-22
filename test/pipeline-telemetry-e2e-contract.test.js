'use strict';

// Static contract for Part B of the pipeline-progress proposal: the e2e suite
// must prove that a real build's run receipts reach the telemetry dashboard.
// Runs in the cheap main suite (no live `claude -p`, no docker) and asserts the
// wiring is present:
//   1. the shared claude-runner sets HARNESS_PUSHGATEWAY_URL so e2e builds push
//      their receipts live via the record-run hook (same path as production);
//   2. the build+observability e2e ASSERTS the build's own receipts landed in
//      Prometheus (harness_conversation_turns_total), not just phase_eval.
// See docs/internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md §3 Part B.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const RUNNER = path.join('test', 'e2e', 'helpers', 'claude-runner.js');
const BUILD = path.join('test', 'e2e', 'harness-pipeline-build.test.js');

test('claude-runner enables harness telemetry alongside native OTEL', () => {
  const runner = read(RUNNER);
  assert.match(runner, /CLAUDE_CODE_ENABLE_TELEMETRY/, 'native OTEL still enabled');
  assert.match(
    runner,
    /HARNESS_PUSHGATEWAY_URL:\s*process\.env\.HARNESS_PUSHGATEWAY_URL\s*\|\|\s*['"]http:\/\/localhost:9091['"]/,
    'buildClaudeEnv must point the record-run hook at the pushgateway so e2e builds push receipts'
  );
});

test('the pushgateway URL is set inside buildClaudeEnv, not only documented', () => {
  const runner = read(RUNNER);
  const start = runner.indexOf('function buildClaudeEnv');
  const envFn = runner.slice(start, runner.indexOf('\n}', start));
  assert.match(envFn, /HARNESS_PUSHGATEWAY_URL/, 'lives in the env builder');
});

test('the build+observability e2e asserts the build receipts reached Prometheus', () => {
  const build = read(BUILD);
  assert.match(
    build,
    /pollMetric\(\s*['"]harness_conversation_turns_total['"]/,
    'must poll Prometheus for the build-generated turn metric'
  );
  assert.match(
    build,
    /assert\.ok\(\s*turns\.exists/,
    'turn metric must be asserted (dashboard ingestion proof), not merely logged'
  );
});

test('the turn metric is no longer treated as merely informational', () => {
  const build = read(BUILD);
  const infoBlock = build.slice(build.indexOf('infoMetrics'), build.indexOf('infoMetrics') + 300);
  assert.doesNotMatch(
    infoBlock,
    /harness_conversation_turns_total/,
    'a metric that is now asserted must be removed from the informational-only list'
  );
});
