'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, before, after } = require('node:test');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { assertMetricExists, isPrometheusUp, pollMetric } = require('./helpers/prometheus-checker');
const { isGrafanaUp, getDashboard, listDashboards } = require('./helpers/grafana-checker');

// ── Paths ──────────────────────────────────────────────────────────────────────

const RESULTS_DIR = path.join(__dirname, 'results');
const OUTPUT_DIR = path.join(__dirname, 'output');

let PROJECT_DIR;

// ── Helpers ────────────────────────────────────────────────────────────────────

function findFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function logResult(stage, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, stage + '.json'), JSON.stringify(data, null, 2));
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('Harness E2E Pipeline — Build + Observability', { timeout: 900000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (!fs.existsSync(PROJECT_DIR)) {
      console.log('[e2e] No output/ dir — run harness-pipeline.test.js first');
      process.exit(1);
    }
    console.log('[e2e] Project directory:', PROJECT_DIR);
  });

  after(() => {
    console.log('[e2e] Build+Observability stages complete. Artifacts at:', PROJECT_DIR);
  });

  // ── Stage 4: Auto/Solo ───────────────────────────────────────────────────

  test('Stage 4 - Auto: autonomous build loop', { timeout: 180000 }, () => {
    // Write tests first (TDD): test files must be written before production files
    // so the pre-write-gate TDD hook does not block production writes.
    const autoPrompt =
      'Create a Node.js CLI todo app. Write files in this order — tests FIRST, then implementation.\n\n' +
      'FILE 1: tests/todo.test.js — tests using node:test and node:assert for the add/list/complete/delete commands.\n' +
      'FILE 2: tests/storage.test.js — tests for storage module (read/write todos.json).\n' +
      'FILE 3: storage.js — module that reads/writes todos.json. Each todo: {id, text, completed, createdAt}.\n' +
      'FILE 4: todo.js — CLI entry point parsing process.argv: add <text>, list, complete <id>, delete <id>.\n\n' +
      'Use only Node.js built-ins. Exit 0 on success, 1 on error. Write tests first, then implementation.';
    const result = runClaude(autoPrompt, {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '1.00', timeoutMs: 170000,
    });

    const allSourceFiles = findFiles(PROJECT_DIR, /\.(js|ts)$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('.claude'));
    const sourceFileCount = allSourceFiles.length;

    let featuresPassing = 0; let featuresTotal = 0;
    const featuresPath = path.join(PROJECT_DIR, 'features.json');
    if (fs.existsSync(featuresPath)) {
      try {
        const features = JSON.parse(fs.readFileSync(featuresPath, 'utf8'));
        if (Array.isArray(features)) {
          featuresTotal = features.length;
          featuresPassing = features.filter((f) => f.status === 'pass' || f.status === 'PASS' || f.pass === true).length;
        }
      } catch (_) {}
    }

    const runsDir = path.join(PROJECT_DIR, '.claude/runs');
    const runFiles = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.jsonl')) : [];

    logResult('stage-5-auto', {
      exitCode: result.exitCode, signal: result.signal, sourceFileCount,
      featuresPassing, featuresTotal, runFileCount: runFiles.length,
      sourceFiles: allSourceFiles.map((f) => path.relative(PROJECT_DIR, f)),
    });
    console.log('[e2e] Source file count:', sourceFileCount, '| Features:', featuresPassing, '/', featuresTotal);
    assert.ok(sourceFileCount >= 1, `Auto/Solo must produce at least 1 source file (found ${sourceFileCount})`);
  });

  // ── Stage 5: Telemetry / Prometheus ──────────────────────────────────────

  test('Stage 5 - Telemetry: Prometheus metrics', { timeout: 90000 }, async () => {
    const up = await isPrometheusUp();
    if (!up) {
      console.log('[e2e] Prometheus not running. Skipping.');
      console.log('[e2e]   Start: docker compose -f telemetry_docker_compose.yml up -d');
      logResult('stage-5-prometheus', { skipped: true });
      return;
    }

    // Poll up to 60s for harness_phase_eval_score (pushed in Stage 3b; prometheus scrapes pushgateway every 15s).
    const scoreCheck = await pollMetric('harness_phase_eval_score', 5000, 60000);
    assert.ok(scoreCheck.exists, 'harness_phase_eval_score must exist in Prometheus after push in Stage 3b');
    console.log(`[e2e] harness_phase_eval_score: FOUND (${scoreCheck.resultCount})`);

    // Remaining harness_* metrics are informational.
    const infoMetrics = [
      'harness_conversation_turns_total', 'harness_agent_runs_total',
      'harness_phase_eval_iterations_total', 'claude_code_session_count_total',
    ];
    for (const m of infoMetrics) {
      const check = await assertMetricExists(m);
      console.log(`[e2e] ${m}: ${check.exists ? `FOUND (${check.resultCount})` : 'NOT FOUND'}`);
    }

    // Advisory: count all claude_code_* series.
    try {
      const { queryPrometheus } = require('./helpers/prometheus-checker');
      const advisory = await queryPrometheus('count({__name__=~"claude_code_.*"})');
      const cnt = advisory.data && advisory.data.result && advisory.data.result[0] && advisory.data.result[0].value[1];
      console.log(`[e2e] claude_code_* series count (advisory): ${cnt || 'n/a'}`);
    } catch (err) {
      console.log('[e2e] claude_code_* advisory query failed (non-fatal):', err.message);
    }

    logResult('stage-5-prometheus', { up: true, scoreExists: scoreCheck.exists });
  });

  // ── Stage 6: Grafana dashboard ──────────────────────────────────────────

  test('Stage 6 - Grafana: dashboard verification', { timeout: 30000 }, async () => {
    const up = await isGrafanaUp();
    if (!up) {
      console.log('[e2e] Grafana not running. Skipping.');
      logResult('stage-6-grafana', { skipped: true });
      return;
    }

    const dashboards = await listDashboards();
    if (Array.isArray(dashboards.data)) {
      console.log('[e2e] Dashboards:', dashboards.data.map((d) => d.title).join(', '));
    }

    const dash = await getDashboard('claude-harness-overview');
    assert.ok(dash.status === 200 && dash.data && dash.data.dashboard,
      `claude-harness-overview dashboard must exist (got status ${dash.status})`);

    const panels = dash.data.dashboard.panels || [];
    const sections = panels.filter((p) => p.type === 'row').map((p) => p.title);
    const hasPhaseQuality = sections.some((s) => /phase.?quality/i.test(s));
    const hasNativeOtel = sections.some((s) => /native.?otel/i.test(s) || /claude.?code/i.test(s));
    const hasVelocity = sections.some((s) => /velocity/i.test(s));
    console.log('[e2e] Dashboard sections:', sections.join(', '));
    console.log(`[e2e] Phase Quality: ${hasPhaseQuality ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`[e2e] Native OTEL: ${hasNativeOtel ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`[e2e] Velocity: ${hasVelocity ? 'FOUND' : 'NOT FOUND'}`);

    logResult('stage-6-grafana', { up: true, status: dash.status, sections });
  });

});
