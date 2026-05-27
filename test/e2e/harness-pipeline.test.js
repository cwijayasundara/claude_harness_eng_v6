'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, before, after } = require('node:test');
const { execFileSync } = require('child_process');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { assertMetricExists, isPrometheusUp } = require('./helpers/prometheus-checker');
const { isGrafanaUp, getDashboard, listDashboards } = require('./helpers/grafana-checker');

// ── Paths ──────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');
const OUTPUT_DIR = path.join(__dirname, 'output');

let PROJECT_DIR;
let BRD_PATH = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileExists(relativePath) {
  return fs.existsSync(path.join(PROJECT_DIR, relativePath));
}

function readArtifact(relativePath) {
  return fs.readFileSync(path.join(PROJECT_DIR, relativePath), 'utf8');
}

function logResult(stage, data) {
  const logPath = path.join(RESULTS_DIR, stage + '.json');
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

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

function findFilesInProject(relativePath, pattern) {
  return findFiles(path.join(PROJECT_DIR, relativePath), pattern);
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('Harness E2E Pipeline', { timeout: 600000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (fs.existsSync(PROJECT_DIR)) {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    // Create a git boundary so Claude CLI treats output/ as a standalone project
    // instead of traversing up to the parent repo root.
    execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Harness root:', HARNESS_ROOT);
  });

  after(() => {
    console.log('[e2e] Artifacts saved to:', PROJECT_DIR);
  });

  // ── Stage 1: BRD (fixture-based) ───────────────────────────────────────────

  test('Stage 1 - BRD: load business requirements from fixture', { timeout: 5000 }, () => {
    const brdSrc = path.join(FIXTURES_DIR, 'brd.md');
    const brdDest = path.join(PROJECT_DIR, 'specs', 'brd');
    fs.mkdirSync(brdDest, { recursive: true });
    fs.copyFileSync(brdSrc, path.join(brdDest, 'brd.md'));

    const brdPath = 'specs/brd/brd.md';
    assert.ok(fileExists(brdPath), 'BRD fixture must be copied');
    const charCount = readArtifact(brdPath).length;
    assert.ok(charCount > 200, `BRD must have > 200 chars (got ${charCount})`);

    BRD_PATH = brdPath;
    logResult('stage-2-brd', { brdPath, charCount, fixture: true });
    console.log(`[e2e] BRD loaded from fixture: ${brdPath} (${charCount} chars)`);
  });

  // ── Stage 1b: BRD structural validation ─────────────────────────────────

  test('Stage 1b - BRD structural validation', { timeout: 5000 }, () => {
    if (!BRD_PATH) {
      logResult('stage-2b-brd-llm', { skipped: true, reason: 'BRD missing' });
      return;
    }

    const content = readArtifact(BRD_PATH);
    const requiredSections = ['Executive Summary', 'Goals', 'Success Metrics', 'Scope', 'Data Model'];
    const found = requiredSections.filter((s) => content.includes(s));
    const missing = requiredSections.filter((s) => !content.includes(s));

    logResult('stage-2b-brd-llm', { pass: missing.length === 0, found, missing });
    console.log(`[e2e] BRD sections: ${found.length}/${requiredSections.length} present`);
    if (missing.length > 0) console.log('[e2e]   Missing:', missing.join(', '));
  });

  // ── Stage 2: Spec (fixture-based) ───────────────────────────────────────

  test('Stage 2 - Spec: load stories from fixture', { timeout: 5000 }, () => {
    const storiesSrc = path.join(FIXTURES_DIR, 'stories');
    const storiesDest = path.join(PROJECT_DIR, 'specs', 'stories');
    copyDirSync(storiesSrc, storiesDest);

    const featuresSrc = path.join(FIXTURES_DIR, 'features.json');
    fs.copyFileSync(featuresSrc, path.join(PROJECT_DIR, 'features.json'));

    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    const storyCount = storyFiles.length;

    let featureCount = 0;
    const features = JSON.parse(readArtifact('features.json'));
    assert.ok(Array.isArray(features), 'features.json must be a JSON array');
    featureCount = features.length;

    logResult('stage-3-spec', {
      fixture: true,
      storyCount,
      featureCount,
      storyFiles: storyFiles.map((f) => path.basename(f)),
    });

    assert.ok(
      storyCount >= 1,
      `Spec fixture must have at least 1 story file matching E*-S*.md (found ${storyCount})`
    );
    console.log('[e2e] Story count:', storyCount, '| Feature count:', featureCount);
  });

  // ── Stage 2b: Spec structural validation ────────────────────────────────

  test('Stage 2b - Spec structural validation', { timeout: 5000 }, () => {
    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    assert.ok(storyFiles.length > 0, 'Must have story files');

    const requiredFields = ['Acceptance Criteria', 'User Story', 'Group', 'Readiness'];
    let allValid = true;
    for (const f of storyFiles) {
      const content = fs.readFileSync(f, 'utf8');
      for (const field of requiredFields) {
        if (!content.includes(field)) {
          console.log(`[e2e] ${path.basename(f)} missing: ${field}`);
          allValid = false;
        }
      }
    }

    assert.ok(fileExists('specs/stories/epics.md'), 'epics.md must exist');
    assert.ok(fileExists('specs/stories/dependency-graph.md'), 'dependency-graph.md must exist');

    logResult('stage-3b-spec-llm', { pass: allValid, storyCount: storyFiles.length });
    console.log(`[e2e] Spec validation: ${allValid ? 'PASS' : 'FAIL'} (${storyFiles.length} stories)`);
  });

  // ── Stage 3: Design (fixture-based) ─────────────────────────────────────

  test('Stage 3 - Design: load architecture from fixture', { timeout: 5000 }, () => {
    const designSrc = path.join(FIXTURES_DIR, 'design');
    const designDest = path.join(PROJECT_DIR, 'specs', 'design');
    copyDirSync(designSrc, designDest);

    const designArtifacts = fs.readdirSync(designDest);
    logResult('stage-4-design', { fixture: true, designArtifacts });
    console.log('[e2e] Design artifacts:', designArtifacts);

    const expected = ['system-design.md', 'api-contracts.md', 'data-models.md', 'folder-structure.md', 'component-map.md'];
    for (const file of expected) {
      assert.ok(designArtifacts.includes(file), `Design must include ${file}`);
    }
  });

  // ── Stage 3b: Phase Evaluation telemetry ──────────────────────────────────

  test('Stage 3b - Phase Evaluation: push phase quality metrics', { timeout: 30000 }, async () => {
    const reviewsDir = path.join(PROJECT_DIR, 'specs', 'reviews');
    fs.mkdirSync(reviewsDir, { recursive: true });

    const phases = [
      { phase: 'brd', scores: { completeness: 8, traceability: 10, specificity: 7, consistency: 8, actionability: 7 }, weighted_average: 8.0, verdict: 'PASS' },
      { phase: 'spec', scores: { completeness: 7, traceability: 8, specificity: 7, consistency: 8, actionability: 7 }, weighted_average: 7.4, verdict: 'PASS' },
      { phase: 'design', scores: { completeness: 8, traceability: 7, specificity: 8, consistency: 8, actionability: 8 }, weighted_average: 7.8, verdict: 'PASS' },
    ];

    for (const p of phases) {
      fs.writeFileSync(path.join(reviewsDir, `phase-${p.phase}-eval.json`), JSON.stringify({
        phase: p.phase,
        iteration: 1,
        scores: p.scores,
        weighted_average: p.weighted_average,
        verdict: p.verdict,
        score_history: [{ iteration: 1, ...p }],
      }, null, 2));
    }

    const telemetryMem = require(path.join(HARNESS_ROOT, '..', '.claude', 'scripts', 'telemetry-memory'));
    const stateDir = path.join(PROJECT_DIR, '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });

    for (const p of phases) {
      telemetryMem.appendLedger(stateDir, {
        kind: 'phase_eval',
        ts: Date.now(),
        user: 'e2e-test',
        session_id: 'e2e-pipeline',
        phase: p.phase,
        iteration: '1',
        scores: p.scores,
        weighted_average: p.weighted_average,
        verdict: p.verdict,
        lane: 'build',
        mode: 'full',
        group_id: 'none',
        story_id: 'none',
        host: os.hostname(),
      });
    }

    const result = await telemetryMem.pushSnapshot({ projectDir: PROJECT_DIR, stateDir });
    const pushed = result && result.pushed;

    logResult('stage-3b-phase-eval', {
      pushed,
      phases: phases.map((p) => p.phase),
      evalFiles: fs.readdirSync(reviewsDir),
    });

    console.log('[e2e] Phase eval records pushed:', pushed, '| Phases:', phases.map((p) => p.phase).join(', '));
  });

  // ── Stage 4: Auto/Solo ───────────────────────────────────────────────────

  test('Stage 4 - Auto/Solo: autonomous build loop', { timeout: 300000 }, () => {
    // Write a project-scoped CLAUDE.md to prevent skill/pipeline overhead
    fs.writeFileSync(path.join(PROJECT_DIR, 'CLAUDE.md'),
      'Write code directly. Do not use skills, planning workflows, or brainstorming. Just create the files requested.'
    );

    const autoPrompt =
      'Create a Node.js CLI todo app. Write these files directly — do NOT read any other files first.\n\n' +
      'FILE 1: todo.js — CLI entry point that parses process.argv for commands: add <text>, list, complete <id>, delete <id>.\n' +
      'FILE 2: storage.js — module that reads/writes todos.json. Each todo: {id, text, completed, createdAt}.\n' +
      'FILE 3: tests/todo.test.js — basic test using node:test and node:assert.\n\n' +
      'Use only Node.js built-ins. Exit 0 on success, 1 on error. Start writing files immediately.';
    const result = runClaude(autoPrompt, {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '2.00',
      timeoutMs: 290000,
    });

    // Find all .js/.ts source files, excluding node_modules and .claude
    const allSourceFiles = findFiles(PROJECT_DIR, /\.(js|ts)$/)
      .filter((f) => !f.includes('node_modules') && !f.includes('.claude'));
    const sourceFileCount = allSourceFiles.length;

    let featuresPassing = 0;
    let featuresTotal = 0;
    if (fileExists('features.json')) {
      try {
        const features = JSON.parse(readArtifact('features.json'));
        if (Array.isArray(features)) {
          featuresTotal = features.length;
          featuresPassing = features.filter(
            (f) => f.status === 'pass' || f.status === 'PASS' || f.pass === true
          ).length;
        }
      } catch (_) { /* ignore parse errors */ }
    }

    // Check for .claude/runs/ JSONL files
    const runsDir = path.join(PROJECT_DIR, '.claude/runs');
    let runFiles = [];
    if (fs.existsSync(runsDir)) {
      runFiles = fs.readdirSync(runsDir).filter((f) => f.endsWith('.jsonl'));
    }

    logResult('stage-5-auto-solo', {
      exitCode: result.exitCode,
      signal: result.signal,
      sourceFileCount,
      featuresPassing,
      featuresTotal,
      runFileCount: runFiles.length,
      sourceFiles: allSourceFiles.map((f) => path.relative(PROJECT_DIR, f)),
    });

    console.log('[e2e] Source file count:', sourceFileCount);
    console.log('[e2e] Features passing:', featuresPassing, '/', featuresTotal);
    console.log('[e2e] Run JSONL files:', runFiles.length);

    assert.ok(
      sourceFileCount >= 1,
      `Auto/Solo must produce at least 1 source file (found ${sourceFileCount})`
    );
  });

  // ── Stage 5: Telemetry / Prometheus ──────────────────────────────────────

  test('Stage 5 - Telemetry: Prometheus metrics', { timeout: 30000 }, async () => {
    const up = await isPrometheusUp();
    if (!up) {
      console.log('[e2e] Prometheus not running. Skipping.');
      console.log('[e2e]   Start: docker compose -f telemetry_docker_compose.yml up -d');
      return;
    }

    const metrics = [
      'harness_conversation_turns_total',
      'harness_agent_runs_total',
      'harness_phase_eval_score',
      'harness_phase_eval_iterations_total',
      'claude_code_session_count_total',
    ];

    for (const m of metrics) {
      const check = await assertMetricExists(m);
      console.log(`[e2e] ${m}: ${check.exists ? `FOUND (${check.resultCount})` : 'NOT FOUND'}`);
    }
  });

  // ── Stage 6: Grafana dashboard ──────────────────────────────────────────

  test('Stage 6 - Grafana: dashboard verification', { timeout: 30000 }, async () => {
    const up = await isGrafanaUp();
    if (!up) {
      console.log('[e2e] Grafana not running. Skipping.');
      return;
    }

    const dashboards = await listDashboards();
    if (Array.isArray(dashboards.data)) {
      console.log('[e2e] Dashboards:', dashboards.data.map((d) => d.title).join(', '));
    }

    const dash = await getDashboard('claude-harness-overview');
    if (dash.status === 200 && dash.data && dash.data.dashboard) {
      const panels = dash.data.dashboard.panels || [];
      const sections = panels.filter((p) => p.type === 'row').map((p) => p.title);
      console.log('[e2e] Dashboard sections:', sections.join(', '));

      const hasPhaseQuality = sections.some((s) => /phase.?quality/i.test(s));
      const hasNativeOtel = sections.some((s) => /native.?otel/i.test(s) || /claude.?code/i.test(s));
      const hasVelocity = sections.some((s) => /velocity/i.test(s));
      console.log(`[e2e] Phase Quality: ${hasPhaseQuality ? 'FOUND' : 'NOT FOUND'}`);
      console.log(`[e2e] Native OTEL: ${hasNativeOtel ? 'FOUND' : 'NOT FOUND'}`);
      console.log(`[e2e] Velocity: ${hasVelocity ? 'FOUND' : 'NOT FOUND'}`);
    } else {
      console.log('[e2e] Dashboard not found (status', dash.status + ')');
    }
  });

});

