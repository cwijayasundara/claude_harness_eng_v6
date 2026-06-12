'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, before } = require('node:test');
const { execFileSync } = require('child_process');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');
const { isPrometheusUp, assertMetricExists, pollMetric } = require('./helpers/prometheus-checker');
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
      // Throwing fails this suite's tests with a clear message; process.exit
      // would kill the runner without marking anything.
      throw new Error('No output/ dir — run harness-pipeline.test.js first (sequential dependency)');
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
      'Base findings on the actual files in this directory and cite real file paths in every map.';
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '2.00',
      timeoutMs: 170000,
    });

    let artifacts = [];
    const bfDir = path.join(PROJECT_DIR, 'specs/brownfield');
    if (fs.existsSync(bfDir)) artifacts = fs.readdirSync(bfDir);

    // Discipline, not just artifact count: all three requested maps exist and
    // are grounded — they mention at least one real source file of this repo.
    const required = ['architecture-map.md', 'test-map.md', 'risk-map.md'];
    const srcBasenames = findFiles(PROJECT_DIR, /\.js$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('specs'))
      .map((f) => path.basename(f));
    const grounding = {};
    for (const name of required) {
      const p = path.join(bfDir, name);
      grounding[name] = fs.existsSync(p)
        ? srcBasenames.some((b) => fs.readFileSync(p, 'utf8').includes(b))
        : null;
    }

    logResult('stage-6-brownfield', { exitCode: result.exitCode, artifacts, grounding });
    console.log('[e2e] Brownfield artifacts:', artifacts, 'grounding:', grounding);

    for (const name of required) {
      assert.notStrictEqual(grounding[name], null, `${name} must be written`);
      assert.ok(grounding[name], `${name} must cite at least one real source file (${srcBasenames.join(', ')})`);
    }
  });

  // ── Stage 6b: Code graph ──────────────────────────────────────────────

  test('Stage 6b - Code Graph: AST indexer produces the real schema', { timeout: 180000 }, (t) => {
    // Run the actual production indexer (what /code-map invokes), not an
    // LLM-synthesized approximation — this is the integration gate for the
    // vendored-ast schema all downstream brownfield skills consume.
    const { spawnSync } = require('child_process');
    // The JS/TS path needs the tree-sitter wheels; skip loudly (not fail
    // inscrutably) when the host python3 lacks them.
    const probe = spawnSync('python3', ['-c', 'import tree_sitter, tree_sitter_javascript'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      t.skip('tree-sitter wheels not installed in python3 — `pip install tree-sitter tree-sitter-javascript tree-sitter-typescript` to enable the AST indexer gate');
      return;
    }
    const indexer = path.join(
      __dirname, '..', '..', '.claude', 'skills', 'code-map', 'scripts',
      'code_index', 'code_index.py'
    );
    const graphPath = path.join(PROJECT_DIR, 'specs', 'brownfield', 'code-graph.json');
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
    // The generated app wires todo.js -> storage.js (CommonJS or ESM); a
    // 0-edge graph means import extraction is coupling-blind for this app.
    assert.ok(edgeCount >= 1, `Code graph must have >= 1 import edge (found ${edgeCount})`);
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

    // Discipline, not string-grep: a TEST exercises the new search command,
    // and the full suite passes — "do NOT break existing commands" verified
    // by running them. Preflight engagement is logged, not asserted (a
    // sprouted new file is a legitimate route that skips the gate).
    const searchTested = filesAfter
      .filter((f) => /\.(test|spec)\.js$/.test(f) || /(^|\/)tests?\//.test(f))
      .some((f) => { try { return fs.readFileSync(f, 'utf8').toLowerCase().includes('search'); } catch (_) { return false; } });
    const suite = runProjectSuite(PROJECT_DIR);
    const preflightEngaged = fileExists('.claude/state/coverage-preflight-cache.json');

    logResult('stage-6c-brownfield-change', {
      exitCode: result.exitCode,
      filesBefore: filesBefore.length,
      filesAfter: filesAfter.length,
      searchTested,
      suiteStatus: suite.status,
      preflightEngaged,
      files: filesAfter.map((f) => path.relative(PROJECT_DIR, f)),
    });

    console.log(`[e2e] search test: ${searchTested}; suite exit: ${suite.status}; preflight engaged: ${preflightEngaged}`);
    assert.ok(searchTested, 'a test file must exercise the new search command');
    assert.strictEqual(suite.status, 0, `existing + new tests must pass after the change:\n${suite.out}`);
  });

  // ── Stage 7: Telemetry / Prometheus ───────────────────────────────────

  test('Stage 7 - Telemetry: Prometheus metrics', { timeout: 90000 }, async () => {
    // Push a brownfield-lane ledger record before querying.
    const telemetryMem = require(path.join(HARNESS_ROOT, '..', '.claude', 'scripts', 'telemetry-memory'));
    const stateDir = path.join(PROJECT_DIR, '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    telemetryMem.appendLedger(stateDir, {
      kind: 'phase_eval', ts: Date.now(), user: 'e2e-brownfield', session_id: 'e2e-brownfield',
      phase: 'brownfield', iteration: '1',
      scores: { completeness: 8, traceability: 8, specificity: 7, consistency: 8, actionability: 7 },
      weighted_average: 7.6, verdict: 'PASS', lane: 'brownfield', mode: 'full',
      group_id: 'none', story_id: 'none', host: os.hostname(),
    });
    const gatewayUrl = process.env.HARNESS_PUSHGATEWAY_URL || 'http://localhost:9091';
    await telemetryMem.pushSnapshot({ projectDir: PROJECT_DIR, stateDir, gatewayUrl });

    const up = await isPrometheusUp();
    if (!up) {
      console.log('[e2e] Prometheus not running. Skipping.');
      logResult('stage-7-prometheus', { skipped: true });
      return;
    }

    const scoreCheck = await pollMetric('harness_phase_eval_score', 5000, 60000);
    assert.ok(scoreCheck.exists, 'harness_phase_eval_score must appear in Prometheus');

    const infoMetrics = ['harness_conversation_turns_total', 'harness_phase_eval_iterations_total'];
    const results = { harness_phase_eval_score: scoreCheck };
    let anyHarnessFound = scoreCheck.exists;
    for (const m of infoMetrics) {
      const check = await assertMetricExists(m);
      results[m] = check;
      if (check.exists) anyHarnessFound = true;
      console.log(`[e2e] ${m}: ${check.exists ? `FOUND (${check.resultCount})` : 'NOT FOUND'}`);
    }
    assert.ok(anyHarnessFound, 'At least one harness_* metric must exist in Prometheus');
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
      if (Array.isArray(list.data)) dashboards = list.data.map((d) => ({ uid: d.uid, title: d.title }));
    } catch (err) { console.log('[e2e] Failed to list dashboards:', err.message); }
    console.log('[e2e] Grafana dashboards:', JSON.stringify(dashboards));

    const dash = await getDashboard('claude-harness-overview');
    assert.ok(dash.status === 200 && dash.data && dash.data.dashboard,
      `claude-harness-overview dashboard must exist (got status ${dash.status})`);

    const panels = dash.data.dashboard.panels || [];
    // harness-overview.json provisions a row titled "Phase Quality" — assert it.
    const hasPhasePanel = panels.some((p) => p.title && /phase.?quality/i.test(p.title));
    assert.ok(hasPhasePanel, 'Dashboard must have a Phase Quality panel (provisioned in harness-overview.json)');
    console.log('[e2e] Phase Quality panel: FOUND');

    logResult('stage-8-grafana', { up: true, dashboards, hasPhasePanel });
  });
});
