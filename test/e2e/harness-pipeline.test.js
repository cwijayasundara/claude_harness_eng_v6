'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, before, after } = require('node:test');
const { execFileSync } = require('child_process');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { assertMetricExists, isPrometheusUp, pollMetric } = require('./helpers/prometheus-checker');
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

function probeUrl(url) {
  return new Promise((resolve) => {
    const http = require('http');
    http.get(url, { agent: false }, (res) => resolve(res.statusCode === 200))
      .on('error', () => resolve(false));
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('Harness E2E Pipeline', { timeout: 1500000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (fs.existsSync(PROJECT_DIR)) {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Harness root:', HARNESS_ROOT);
  });

  after(() => {
    console.log('[e2e] Artifacts saved to:', PROJECT_DIR);
  });

  // ── Stage 0: Scaffold ─────────────────────────────────────────────────────

  // /scaffold mandates Q1 + a confirmation card, so one -p turn only prints the
  // question. Two turns: invoke /scaffold, then answer Q1 + consent (Step 1.D).
  test('Stage 0 - Scaffold: /scaffold initializes the harness project', { timeout: 600000 }, () => {
    const pluginDir = path.join(HARNESS_ROOT, '..', '.claude');
    const sessionId = require('crypto').randomUUID();
    runClaude('/scaffold', {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '1.00', timeoutMs: 90000, pluginDir, sessionId,
    });
    const result = runClaude(
      'A Node.js CLI todo application using only Node built-ins; project shape: ' +
      'script/CLI; user surface: CLI; no team integrations, no tracker, no framework ' +
      'packs. I will not answer further questions — accept the inferred profile ' +
      '(option A) and proceed to scaffold everything now without asking anything else.',
      { cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '3.00', timeoutMs: 480000, continueSession: true, pluginDir, sessionId }
    );

    const hasClaudeDir = fs.existsSync(path.join(PROJECT_DIR, '.claude'));
    const hasClaudeMd = fs.existsSync(path.join(PROJECT_DIR, 'CLAUDE.md'));
    const hasManifest = fs.existsSync(path.join(PROJECT_DIR, 'project-manifest.json'));
    const topFiles = fs.readdirSync(PROJECT_DIR);

    logResult('stage-0-scaffold', {
      exitCode: result.exitCode, hasClaudeDir, hasClaudeMd, hasManifest, topFiles,
    });

    assert.ok(hasClaudeDir, '.claude/ directory must exist after scaffold');
    assert.ok(hasClaudeMd || hasManifest, 'CLAUDE.md or project-manifest.json must exist after scaffold');

    // Append suppression directive so downstream stages skip pipeline overhead.
    const claudeMdPath = path.join(PROJECT_DIR, 'CLAUDE.md');
    fs.appendFileSync(claudeMdPath,
      '\n\n## E2E override\n' +
      'Write code and files directly. Do not use skills, planning workflows, or brainstorming. ' +
      'Just create the files requested.\n'
    );
    console.log('[e2e] Stage 0 scaffold complete. Top-level files:', topFiles.join(', '));
  });

  // ── Stage 1: BRD ──────────────────────────────────────────────────────────

  test('Stage 1 - BRD: generate business requirements', { timeout: 120000 }, () => {
    const brdRequirements = fs.readFileSync(
      path.join(FIXTURES_DIR, 'todo-cli-brd-prompt.md'), 'utf8'
    );
    const prompt =
      'You MUST create the directory specs/brd/ using mkdir, then write a file called specs/brd/brd.md. ' +
      'Write ALL of the following sections: Executive Summary, Goals, Target Users, Success Metrics, ' +
      'Scope, MVP Definition, Alternatives, Technical Architecture, Data Model, Integrations, ' +
      'Constraints, UI Context, Open Questions.\n\nRequirements:\n\n' + brdRequirements;
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '0.50', timeoutMs: 110000,
    });

    const candidates = ['specs/brd/brd.md', 'brd.md', 'specs/brd.md', 'docs/brd.md'];
    let brdPath = candidates.find((p) => fileExists(p));
    if (!brdPath) {
      const mdFiles = findFiles(PROJECT_DIR, /brd.*\.md$/i).map((f) => path.relative(PROJECT_DIR, f));
      if (mdFiles.length > 0) brdPath = mdFiles[0];
    }
    const charCount = brdPath ? readArtifact(brdPath).length : 0;
    logResult('stage-2-brd', { exitCode: result.exitCode, signal: result.signal, brdPath: brdPath || 'NOT FOUND', charCount });
    assert.ok(brdPath, 'BRD markdown file must exist');
    assert.ok(charCount > 200, `BRD must have > 200 chars (got ${charCount})`);
    BRD_PATH = brdPath;
    console.log(`[e2e] BRD found at: ${brdPath} (${charCount} chars)`);
  });

  // ── Stage 1b: BRD structural validation ─────────────────────────────────

  test('Stage 1b - BRD structural validation', { timeout: 5000 }, () => {
    if (!BRD_PATH) { logResult('stage-2b-brd-llm', { skipped: true, reason: 'BRD missing' }); return; }
    const content = readArtifact(BRD_PATH);
    const required = ['Summary', 'Goal', 'Metric', 'Scope', 'Model'];
    const found = required.filter((s) => content.toLowerCase().includes(s.toLowerCase()));
    const missing = required.filter((s) => !content.toLowerCase().includes(s.toLowerCase()));
    logResult('stage-2b-brd-llm', { pass: missing.length === 0, found, missing });
    console.log(`[e2e] BRD sections: ${found.length}/${required.length} present`);
    if (missing.length > 0) console.log('[e2e]   Missing (advisory):', missing.join(', '));
  });

  // ── Stage 2: Spec ────────────────────────────────────────────────────────

  test('Stage 2 - Spec: decompose BRD into stories', { timeout: 210000 }, () => {
    if (!BRD_PATH) { logResult('stage-3-spec', { skipped: true, reason: 'BRD missing' }); return; }
    const brdContent = readArtifact(BRD_PATH);
    const specPrompt =
      'Create directory specs/stories/ then create ALL files:\n' +
      '1. specs/stories/E1-S1.md, E1-S2.md, E1-S3.md — each with title, description, user story, ' +
      '3-6 testable acceptance criteria, layer, group (A or B), readiness: ready.\n' +
      '2. specs/stories/epics.md with epic index.\n' +
      '3. specs/stories/dependency-graph.md.\n' +
      '4. features.json array (id, category, story, group, description, steps, passes: false).\n\n' +
      'Decompose this BRD into at least 3 stories:\n\n' + brdContent.slice(0, 4000);
    const result = runClaude(specPrompt, {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '1.00', timeoutMs: 180000, continueSession: true,
    });
    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    let featureCount = 0;
    let featuresValid = true;
    if (fileExists('features.json')) {
      try {
        const features = JSON.parse(readArtifact('features.json'));
        assert.ok(Array.isArray(features), 'features.json must be a JSON array');
        featureCount = features.length;
      } catch (err) { featuresValid = false; console.log('[e2e] features.json parse error:', err.message); }
    }
    logResult('stage-3-spec', {
      exitCode: result.exitCode, signal: result.signal,
      storyCount: storyFiles.length, featureCount, featuresValid,
      storyFiles: storyFiles.map((f) => path.basename(f)),
    });
    assert.ok(storyFiles.length >= 1, `Must produce at least 1 story (found ${storyFiles.length})`);
    console.log('[e2e] Story count:', storyFiles.length, '| Feature count:', featureCount);
  });

  // ── Stage 2b: Spec structural validation ────────────────────────────────

  test('Stage 2b - Spec structural validation', { timeout: 5000 }, () => {
    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    if (storyFiles.length === 0) {
      logResult('stage-3b-spec-llm', { skipped: true, reason: 'no story files' }); return;
    }
    const required = ['acceptance criteria', 'story', 'group'];
    let allValid = true;
    for (const f of storyFiles) {
      const content = fs.readFileSync(f, 'utf8').toLowerCase();
      for (const field of required) {
        if (!content.includes(field)) { console.log(`[e2e] ${path.basename(f)} missing: ${field}`); allValid = false; }
      }
    }
    logResult('stage-3b-spec-llm', { pass: allValid, storyCount: storyFiles.length });
    console.log(`[e2e] Spec validation: ${allValid ? 'PASS' : 'FAIL'} (${storyFiles.length} stories)`);
  });

  // ── Stage 3: Design ──────────────────────────────────────────────────────

  test('Stage 3 - Design: generate architecture', { timeout: 120000 }, () => {
    const designPrompt =
      'Create directory specs/design/ then write ALL 5 files:\n' +
      '1. specs/design/architecture.md\n2. specs/design/api-contracts.md\n' +
      '3. specs/design/data-models.md\n4. specs/design/folder-structure.md\n' +
      '5. specs/design/component-map.md\nEach 10-30 lines.';
    const result = runClaude(designPrompt, {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '0.50', timeoutMs: 110000, continueSession: true,
    });
    const designDir = path.join(PROJECT_DIR, 'specs/design');
    const designArtifacts = fs.existsSync(designDir) ? fs.readdirSync(designDir) : [];
    logResult('stage-4-design', { exitCode: result.exitCode, signal: result.signal, designArtifacts });
    assert.ok(designArtifacts.length >= 1, `Design must produce at least 1 artifact (found ${designArtifacts.length})`);
    console.log('[e2e] Design artifacts:', designArtifacts);
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
        phase: p.phase, iteration: 1, scores: p.scores, weighted_average: p.weighted_average,
        verdict: p.verdict, score_history: [{ iteration: 1, ...p }],
      }, null, 2));
    }
    const telemetryMem = require(path.join(HARNESS_ROOT, '..', '.claude', 'scripts', 'telemetry-memory'));
    const stateDir = path.join(PROJECT_DIR, '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    for (const p of phases) {
      telemetryMem.appendLedger(stateDir, {
        kind: 'phase_eval', ts: Date.now(), user: 'e2e-test', session_id: 'e2e-pipeline',
        phase: p.phase, iteration: '1', scores: p.scores, weighted_average: p.weighted_average,
        verdict: p.verdict, lane: 'build', mode: 'full', group_id: 'none', story_id: 'none', host: os.hostname(),
      });
    }
    const gatewayUrl = process.env.HARNESS_PUSHGATEWAY_URL || 'http://localhost:9091';
    const gwUp = await probeUrl(gatewayUrl + '/-/healthy');
    const result = await telemetryMem.pushSnapshot({ projectDir: PROJECT_DIR, stateDir, gatewayUrl });
    const pushed = result && result.pushed;
    logResult('stage-3b-phase-eval', { pushed, gwUp, phases: phases.map((p) => p.phase), evalFiles: fs.readdirSync(reviewsDir) });
    if (gwUp) {
      assert.ok(pushed, 'pushSnapshot must succeed when pushgateway is up');
    } else {
      console.log('[e2e] Pushgateway not reachable — skipping push assertion');
    }
    console.log('[e2e] Phase eval pushed:', pushed, '| Gateway up:', gwUp);
  });

});
