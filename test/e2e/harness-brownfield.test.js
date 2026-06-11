'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, before } = require('node:test');
const { execFileSync } = require('child_process');

const { runClaude } = require('./helpers/claude-runner');
const { isPrometheusUp, assertMetricExists } = require('./helpers/prometheus-checker');
const { isGrafanaUp, getDashboard, listDashboards } = require('./helpers/grafana-checker');

const OUTPUT_DIR = path.join(__dirname, 'output');
const RESULTS_DIR = path.join(__dirname, 'results');

let PROJECT_DIR;

function fileExists(rel) {
  return fs.existsSync(path.join(PROJECT_DIR, rel));
}

function readArtifact(rel) {
  return fs.readFileSync(path.join(PROJECT_DIR, rel), 'utf8');
}

function logResult(stage, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, stage + '.json'),
    JSON.stringify(data, null, 2)
  );
}

function findFiles(dir, pattern) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.claude'].includes(entry.name)) {
      results.push(...findFiles(full, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe('Harness E2E — Brownfield + Telemetry', { timeout: 1200000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (!fs.existsSync(PROJECT_DIR)) {
      console.log('[e2e] No output/ dir — run harness-pipeline.test.js first');
      process.exit(1);
    }
    // Ensure git boundary exists so Claude CLI stays inside output/
    if (!fs.existsSync(path.join(PROJECT_DIR, '.git'))) {
      execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });
    }
    const jsFiles = findFiles(PROJECT_DIR, /\.js$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('.claude') && !f.includes('specs'));
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Source files found:', jsFiles.length);
  });

  // ── Stage 6: Brownfield discovery ─────────────────────────────────────

  test('Stage 6 - Brownfield: discover existing codebase', { timeout: 180000 }, () => {
    const prompt =
      'Run: mkdir -p specs/brownfield\n' +
      'Then read all .js files in src/ and the root to understand the codebase.\n' +
      'Write these 3 files:\n' +
      '1. specs/brownfield/architecture-map.md — list all modules, entry points, key files\n' +
      '2. specs/brownfield/test-map.md — test commands, test file locations\n' +
      '3. specs/brownfield/risk-map.md — fragile areas, missing tests, coupling concerns\n' +
      'Base findings on the actual files in this directory.';
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '2.00',
      timeoutMs: 170000,
    });

    let artifacts = [];
    const bfDir = path.join(PROJECT_DIR, 'specs/brownfield');
    if (fs.existsSync(bfDir)) artifacts = fs.readdirSync(bfDir);

    logResult('stage-6-brownfield', { exitCode: result.exitCode, artifacts });
    console.log('[e2e] Brownfield artifacts:', artifacts);

    assert.ok(artifacts.length >= 1, 'Brownfield must produce at least 1 artifact');
  });

  // ── Stage 6b: Code graph ──────────────────────────────────────────────

  test('Stage 6b - Code Graph: AST indexer produces the real schema', { timeout: 180000 }, () => {
    // Run the actual production indexer (what /code-map invokes), not an
    // LLM-synthesized approximation — this is the integration gate for the
    // vendored-ast schema all downstream brownfield skills consume.
    const indexer = path.join(
      __dirname, '..', '..', '.claude', 'skills', 'code-map', 'scripts',
      'code_index', 'code_index.py'
    );
    const graphPath = path.join(PROJECT_DIR, 'specs', 'brownfield', 'code-graph.json');
    const { spawnSync } = require('child_process');
    const run = spawnSync('python3', [
      indexer, '--root', PROJECT_DIR, '--out', graphPath,
    ], { encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(run.status, 0, run.stdout + run.stderr);

    const graph = JSON.parse(readArtifact('specs/brownfield/code-graph.json'));
    const nodeCount = (graph.nodes || []).length;
    const edgeCount = (graph.edges || []).length;

    logResult('stage-6b-code-graph', {
      exitCode: run.status,
      producer: graph.meta && graph.meta.producer,
      nodeCount,
      edgeCount,
      filesRecords: (graph.files || []).length,
    });
    console.log(`[e2e] Code graph: ${nodeCount} nodes, ${edgeCount} edges (producer=${graph.meta.producer})`);

    assert.strictEqual(graph.meta.producer, 'vendored-ast', 'AST producer must run');
    assert.ok(nodeCount >= 1, `Code graph must have >= 1 node (found ${nodeCount})`);
    assert.ok((graph.files || []).length >= 1, 'per-file symbol records must exist');
    for (const n of graph.nodes) {
      assert.match(n.id, /^(js|ts|py):/, `node id must carry a language prefix: ${n.id}`);
      assert.strictEqual(n.kind, 'file');
      assert.ok(n.language && n.path && Array.isArray(n.symbols), `node schema invalid: ${n.id}`);
    }
    assert.ok(
      fs.existsSync(graphPath.replace(/\.json$/, '.meta.json')),
      'code-graph.meta.json must be written for the graph-refresh hook'
    );
  });

  // ── Stage 6c: Brownfield code change — add search ─────────────────────

  test('Stage 6c - Brownfield change: add search command', { timeout: 300000 }, () => {
    const filesBefore = findFiles(PROJECT_DIR, /\.js$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('.claude') && !f.includes('specs'));

    const prompt =
      'This is an existing Node.js CLI todo app. Read the source files to understand the codebase. ' +
      'Add a new "search" command: when the user runs the CLI with "search <keyword>", ' +
      'filter todos whose text contains the keyword (case-insensitive) ' +
      'and print matching results in the same format as the list command. ' +
      'Return exit code 0 if matches found, exit code 1 if no matches. ' +
      'Also add a test for the search command in the existing test file. ' +
      'Do NOT break existing commands — only add the new search feature.';
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '2.00',
      timeoutMs: 290000,
    });

    const filesAfter = findFiles(PROJECT_DIR, /\.js$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('.claude') && !f.includes('specs'));

    let hasSearch = false;
    for (const f of filesAfter) {
      try {
        if (fs.readFileSync(f, 'utf8').includes('search')) { hasSearch = true; break; }
      } catch (_) {}
    }

    logResult('stage-6c-brownfield-change', {
      exitCode: result.exitCode,
      filesBefore: filesBefore.length,
      filesAfter: filesAfter.length,
      hasSearchInCode: hasSearch,
      files: filesAfter.map((f) => path.relative(PROJECT_DIR, f)),
    });

    console.log(`[e2e] Files before: ${filesBefore.length}, after: ${filesAfter.length}`);
    console.log(`[e2e] Search command in code: ${hasSearch}`);
    assert.ok(hasSearch, 'Brownfield change must add search functionality to the codebase');
  });

  // ── Stage 7: Telemetry / Prometheus ───────────────────────────────────

  test('Stage 7 - Telemetry: Prometheus metrics', { timeout: 30000 }, async () => {
    const up = await isPrometheusUp();
    if (!up) {
      console.log('[e2e] Prometheus not running. Skipping.');
      console.log('[e2e]   Start: docker compose -f telemetry_docker_compose.yml up -d');
      logResult('stage-7-prometheus', { skipped: true });
      return;
    }

    const metrics = [
      'harness_conversation_turns_total',
      'harness_phase_eval_score',
      'harness_phase_eval_iterations_total',
    ];

    const results = {};
    for (const m of metrics) {
      const check = await assertMetricExists(m);
      results[m] = check;
      console.log(`[e2e] ${m}: ${check.exists ? `FOUND (${check.resultCount})` : 'NOT FOUND'}`);
    }
    logResult('stage-7-prometheus', { up: true, metrics: results });
  });

  // ── Stage 8: Grafana dashboard ────────────────────────────────────────

  test('Stage 8 - Grafana: dashboard verification', { timeout: 30000 }, async () => {
    const up = await isGrafanaUp();
    if (!up) {
      console.log('[e2e] Grafana not running. Skipping.');
      logResult('stage-8-grafana', { skipped: true });
      return;
    }

    let dashboards = [];
    try {
      const list = await listDashboards();
      if (Array.isArray(list.data)) {
        dashboards = list.data.map((d) => ({ uid: d.uid, title: d.title }));
      }
    } catch (err) {
      console.log('[e2e] Failed to list dashboards:', err.message);
    }
    console.log('[e2e] Grafana dashboards:', JSON.stringify(dashboards));

    let hasPhasePanel = false;
    try {
      const dash = await getDashboard('claude-harness-overview');
      if (dash.status === 200 && dash.data && dash.data.dashboard) {
        const panels = dash.data.dashboard.panels || [];
        hasPhasePanel = panels.some((p) => p.title && /phase.?quality/i.test(p.title));
        console.log('[e2e] Phase Quality panel:', hasPhasePanel ? 'FOUND' : 'NOT FOUND');
      } else {
        console.log('[e2e] Dashboard not found (status', dash.status + ')');
      }
    } catch (err) {
      console.log('[e2e] Dashboard error:', err.message);
    }

    logResult('stage-8-grafana', { up: true, dashboards, hasPhasePanel });
  });
});
