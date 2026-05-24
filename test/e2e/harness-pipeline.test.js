'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, before, after } = require('node:test');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { llmValidate } = require('./helpers/llm-validator');
const { queryPrometheus, assertMetricExists, isPrometheusUp } = require('./helpers/prometheus-checker');
const { grafanaGet, isGrafanaUp, getDashboard, listDashboards } = require('./helpers/grafana-checker');

// ── Paths ──────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');
const CRITERIA = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'validation-criteria.json'), 'utf8')
);

let PROJECT_DIR;

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

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('Harness E2E Pipeline', { timeout: 1200000 }, () => {

  before(() => {
    PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-'));
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Harness root:', HARNESS_ROOT);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  });

  after(() => {
    if (process.env.E2E_KEEP_ARTIFACTS === '1') {
      console.log('[e2e] Keeping artifacts at:', PROJECT_DIR);
      return;
    }
    try {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
      console.log('[e2e] Cleaned up:', PROJECT_DIR);
    } catch (err) {
      console.warn('[e2e] Cleanup failed:', err.message);
    }
  });

  // ── Stage 1: Scaffold ────────────────────────────────────────────────────

  test('Stage 1 - Scaffold: initialize project', { timeout: 120000 }, () => {
    const prompt =
      'Initialize this as a Node.js CLI project. Create a CLAUDE.md, ' +
      'package.json with name "todo-cli", and basic project structure.';

    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '0.50',
      timeoutMs: 110000,
    });

    logResult('stage-1-scaffold', {
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
      claudeMdExists: fileExists('CLAUDE.md'),
      packageJsonExists: fileExists('package.json'),
    });

    assert.ok(
      fileExists('CLAUDE.md') || fileExists('package.json'),
      'Scaffold must create at least CLAUDE.md or package.json'
    );
  });

  // ── Stage 2: BRD ─────────────────────────────────────────────────────────

  test('Stage 2 - BRD: generate business requirements', { timeout: 180000 }, () => {
    const brdPrompt = fs.readFileSync(
      path.join(FIXTURES_DIR, 'todo-cli-brd-prompt.md'), 'utf8'
    );
    const prompt = '/brd\n\nHere are the requirements:\n\n' + brdPrompt;

    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '1.00',
      timeoutMs: 170000,
    });

    const brdExists = fileExists('specs/brd/brd.md');
    let charCount = 0;
    if (brdExists) {
      charCount = readArtifact('specs/brd/brd.md').length;
    }

    logResult('stage-2-brd', {
      exitCode: result.exitCode,
      signal: result.signal,
      brdExists,
      charCount,
    });

    assert.ok(brdExists, 'specs/brd/brd.md must exist after /brd');
    assert.ok(charCount > 200, `BRD must have > 200 chars (got ${charCount})`);
    console.log('[e2e] BRD character count:', charCount);
  });

  // ── Stage 2b: BRD LLM validation (advisory) ─────────────────────────────

  test('Stage 2b - BRD LLM validation (advisory)', { timeout: 60000 }, () => {
    const brdPath = path.join(PROJECT_DIR, 'specs/brd/brd.md');
    if (!fs.existsSync(brdPath)) {
      console.log('[e2e] Skipping BRD LLM validation: brd.md not found');
      logResult('stage-2b-brd-llm', { skipped: true, reason: 'brd.md missing' });
      return;
    }

    const validation = llmValidate(brdPath, CRITERIA.brd);

    logResult('stage-2b-brd-llm', {
      pass: validation.pass,
      failures: validation.failures || [],
    });

    if (validation.pass) {
      console.log('[e2e] BRD LLM validation: PASS');
    } else {
      console.log('[e2e] BRD LLM validation: FAIL (advisory)');
      console.log('[e2e]   Failures:', JSON.stringify(validation.failures));
    }
    // Advisory only -- no assert.fail
  });

  // ── Stage 3: Spec ────────────────────────────────────────────────────────

  test('Stage 3 - Spec: decompose BRD into stories', { timeout: 180000 }, () => {
    if (!fileExists('specs/brd/brd.md')) {
      console.log('[e2e] Skipping Spec: brd.md not found');
      logResult('stage-3-spec', { skipped: true, reason: 'brd.md missing' });
      return;
    }

    const prompt = '/spec specs/brd/brd.md';
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '1.00',
      timeoutMs: 170000,
    });

    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    const storyCount = storyFiles.length;

    let featureCount = 0;
    let featuresValid = true;
    if (fileExists('features.json')) {
      try {
        const features = JSON.parse(readArtifact('features.json'));
        assert.ok(Array.isArray(features), 'features.json must be a JSON array');
        featureCount = features.length;
      } catch (err) {
        featuresValid = false;
        console.log('[e2e] features.json parse error:', err.message);
      }
    }

    logResult('stage-3-spec', {
      exitCode: result.exitCode,
      signal: result.signal,
      storyCount,
      featureCount,
      featuresValid,
      storyFiles: storyFiles.map((f) => path.basename(f)),
    });

    assert.ok(
      storyCount >= 1,
      `Spec must produce at least 1 story file matching E*-S*.md (found ${storyCount})`
    );
    console.log('[e2e] Story count:', storyCount, '| Feature count:', featureCount);
  });

  // ── Stage 3b: Spec LLM validation (advisory) ────────────────────────────

  test('Stage 3b - Spec LLM validation (advisory)', { timeout: 60000 }, () => {
    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    if (storyFiles.length === 0) {
      console.log('[e2e] Skipping Spec LLM validation: no story files found');
      logResult('stage-3b-spec-llm', { skipped: true, reason: 'no story files' });
      return;
    }

    const combined = storyFiles
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n---\n');

    // Write combined stories to a temp file for validation
    const tmpPath = path.join(PROJECT_DIR, '.spec-combined-tmp.md');
    fs.writeFileSync(tmpPath, combined);

    const validation = llmValidate(tmpPath, CRITERIA.spec);

    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }

    logResult('stage-3b-spec-llm', {
      pass: validation.pass,
      failures: validation.failures || [],
      storyCount: storyFiles.length,
    });

    if (validation.pass) {
      console.log('[e2e] Spec LLM validation: PASS');
    } else {
      console.log('[e2e] Spec LLM validation: FAIL (advisory)');
      console.log('[e2e]   Failures:', JSON.stringify(validation.failures));
    }
    // Advisory only -- no assert.fail
  });

  // ── Stage 4: Design ──────────────────────────────────────────────────────

  test('Stage 4 - Design: generate architecture', { timeout: 180000 }, () => {
    const result = runClaude('/design', {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '1.50',
      timeoutMs: 170000,
    });

    let designArtifacts = [];
    const designDir = path.join(PROJECT_DIR, 'specs/design');
    if (fs.existsSync(designDir)) {
      designArtifacts = fs.readdirSync(designDir);
    }

    logResult('stage-4-design', {
      exitCode: result.exitCode,
      signal: result.signal,
      designArtifacts,
    });

    console.log('[e2e] Design artifacts:', designArtifacts);
  });

  // ── Stage 5: Auto/Solo ───────────────────────────────────────────────────

  test('Stage 5 - Auto/Solo: autonomous build loop', { timeout: 600000 }, () => {
    const result = runClaude('/auto --mode solo', {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '5.00',
      timeoutMs: 590000,
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
      runFiles.length >= 1,
      `Auto/Solo must produce at least 1 JSONL file in .claude/runs/ (found ${runFiles.length})`
    );
  });

  // ── Stage 6: Brownfield ──────────────────────────────────────────────────

  test('Stage 6 - Brownfield: discover existing codebase', { timeout: 180000 }, () => {
    const result = runClaude('/brownfield', {
      cwd: PROJECT_DIR,
      model: 'haiku',
      budgetUsd: '1.00',
      timeoutMs: 170000,
    });

    let brownfieldArtifacts = [];
    const brownfieldDir = path.join(PROJECT_DIR, 'specs/brownfield');
    if (fs.existsSync(brownfieldDir)) {
      brownfieldArtifacts = fs.readdirSync(brownfieldDir);
    }

    logResult('stage-6-brownfield', {
      exitCode: result.exitCode,
      signal: result.signal,
      brownfieldArtifacts,
    });

    console.log('[e2e] Brownfield artifacts:', brownfieldArtifacts);
  });

  // ── Stage 7: Telemetry / Prometheus ──────────────────────────────────────

  test('Stage 7 - Telemetry: Prometheus metrics', { timeout: 30000 }, async () => {
    const up = await isPrometheusUp();
    if (!up) {
      console.log('[e2e] Prometheus is not running. Skipping telemetry checks.');
      console.log('[e2e]   To enable: docker compose -f telemetry_docker_compose.yml up -d');
      logResult('stage-7-prometheus', { skipped: true, reason: 'Prometheus not running' });
      return;
    }

    const metrics = [
      'harness_conversation_turns_total',
      'harness_phase_eval_score',
      'harness_phase_eval_iterations_total',
    ];

    const results = {};
    for (const metric of metrics) {
      const check = await assertMetricExists(metric);
      results[metric] = check;
      console.log(
        `[e2e] Prometheus metric ${metric}:`,
        check.exists ? `FOUND (${check.resultCount} results)` : 'NOT FOUND'
      );
    }

    logResult('stage-7-prometheus', { prometheusUp: true, metrics: results });
  });

  // ── Stage 8: Grafana dashboard ───────────────────────────────────────────

  test('Stage 8 - Grafana: dashboard verification', { timeout: 30000 }, async () => {
    const up = await isGrafanaUp();
    if (!up) {
      console.log('[e2e] Grafana is not running. Skipping dashboard checks.');
      console.log('[e2e]   To enable: docker compose -f telemetry_docker_compose.yml up -d');
      logResult('stage-8-grafana', { skipped: true, reason: 'Grafana not running' });
      return;
    }

    // List all dashboards
    let dashboards = [];
    try {
      const listResult = await listDashboards();
      if (Array.isArray(listResult.data)) {
        dashboards = listResult.data.map((d) => ({
          uid: d.uid,
          title: d.title,
        }));
      }
    } catch (err) {
      console.log('[e2e] Failed to list dashboards:', err.message);
    }
    console.log('[e2e] Grafana dashboards:', JSON.stringify(dashboards));

    // Check for harness-overview dashboard
    let hasPhaseQualityPanel = false;
    try {
      const dashResult = await getDashboard('harness-overview');
      if (dashResult.status === 200 && dashResult.data && dashResult.data.dashboard) {
        const panels = dashResult.data.dashboard.panels || [];
        hasPhaseQualityPanel = panels.some(
          (p) => p.title && /phase.?quality/i.test(p.title)
        );
        console.log(
          '[e2e] harness-overview dashboard:',
          hasPhaseQualityPanel ? 'Phase Quality panel FOUND' : 'Phase Quality panel NOT FOUND'
        );
      } else {
        console.log('[e2e] harness-overview dashboard: NOT FOUND (status', dashResult.status + ')');
      }
    } catch (err) {
      console.log('[e2e] Failed to get harness-overview dashboard:', err.message);
    }

    logResult('stage-8-grafana', {
      grafanaUp: true,
      dashboards,
      hasPhaseQualityPanel,
    });
  });
});
