'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, before } = require('node:test');

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
    const jsFiles = findFiles(PROJECT_DIR, /\.js$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('.claude') && !f.includes('specs'));
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Source files found:', jsFiles.length);
  });

  // ── Stage 6: Brownfield discovery ─────────────────────────────────────

  test('Stage 6 - Brownfield: discover existing codebase', { timeout: 180000 }, () => {
    const prompt =
      'Analyze the existing codebase in this directory. Create brownfield discovery artifacts in specs/brownfield/: ' +
      'architecture-map.md (list all modules, entry points, key files), ' +
      'test-map.md (test commands, test file locations), ' +
      'risk-map.md (fragile areas, missing tests, coupling concerns). ' +
      'Create specs/brownfield/ directory first. Base findings on actual files you can see.';
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '1.00',
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

  test('Stage 6b - Code Graph: dependency analysis', { timeout: 180000 }, () => {
    const prompt =
      'Analyze the JavaScript source files in this project and create a dependency graph. ' +
      'Write specs/brownfield/code-graph.json with this structure: ' +
      '{"nodes": [{"id": "relative/file/path.js", "type": "module"}], ' +
      '"edges": [{"from": "source.js", "to": "target.js", "type": "import"}]}. ' +
      'Scan all .js files (not in node_modules). For each file, parse its imports and add edges. ' +
      'Also write specs/brownfield/dependency-graph.md with a Mermaid diagram of the imports. ' +
      'Create specs/brownfield/ directory if it does not exist.';
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '0.50',
      timeoutMs: 170000,
    });

    const graphExists = fileExists('specs/brownfield/code-graph.json');
    let nodeCount = 0;
    let edgeCount = 0;
    if (graphExists) {
      try {
        const graph = JSON.parse(readArtifact('specs/brownfield/code-graph.json'));
        nodeCount = (graph.nodes || []).length;
        edgeCount = (graph.edges || []).length;
      } catch (_) {}
    }

    const depGraphExists = fileExists('specs/brownfield/dependency-graph.md');

    logResult('stage-6b-code-graph', {
      exitCode: result.exitCode,
      graphExists,
      nodeCount,
      edgeCount,
      depGraphExists,
    });

    console.log(`[e2e] Code graph: ${nodeCount} nodes, ${edgeCount} edges`);
    console.log(`[e2e] Dependency graph markdown: ${depGraphExists}`);

    assert.ok(graphExists, 'code-graph.json must exist');
    assert.ok(nodeCount >= 1, `Code graph must have >= 1 node (found ${nodeCount})`);
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
