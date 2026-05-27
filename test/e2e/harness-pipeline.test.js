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

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('Harness E2E Pipeline', { timeout: 900000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (fs.existsSync(PROJECT_DIR)) {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });
    // Suppress harness skill/pipeline overhead for all stages
    fs.writeFileSync(path.join(PROJECT_DIR, 'CLAUDE.md'),
      'Write code and files directly. Do not use skills, planning workflows, or brainstorming. Just create the files requested.'
    );
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Harness root:', HARNESS_ROOT);
  });

  after(() => {
    console.log('[e2e] Artifacts saved to:', PROJECT_DIR);
  });

  // ── Stage 1: BRD ──────────────────────────────────────────────────────────

  test('Stage 1 - BRD: generate business requirements', { timeout: 120000 }, () => {
    const brdRequirements = fs.readFileSync(
      path.join(FIXTURES_DIR, 'todo-cli-brd-prompt.md'), 'utf8'
    );
    const prompt =
      'You MUST create the directory specs/brd/ using mkdir, then write a file called specs/brd/brd.md. ' +
      'This is a Business Requirements Document. Write ALL of the following sections into that single file: ' +
      'Executive Summary, Goals, Target Users, Success Metrics (at least 3 with numbers), ' +
      'Scope (In-Scope list and Out-of-Scope list), MVP Definition, Alternatives (at least 2), ' +
      'Technical Architecture, Data Model, Integrations, Constraints, UI Context, Open Questions.\n\n' +
      'Requirements for the project:\n\n' + brdRequirements;

    const result = runClaude(prompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '0.50',
      timeoutMs: 110000,
    });

    const brdCandidates = ['specs/brd/brd.md', 'brd.md', 'specs/brd.md', 'docs/brd.md'];
    let brdPath = brdCandidates.find((p) => fileExists(p));

    if (!brdPath) {
      const mdFiles = findFiles(PROJECT_DIR, /brd.*\.md$/i)
        .map((f) => path.relative(PROJECT_DIR, f));
      if (mdFiles.length > 0) brdPath = mdFiles[0];
    }

    let charCount = 0;
    if (brdPath) charCount = readArtifact(brdPath).length;

    logResult('stage-2-brd', {
      exitCode: result.exitCode,
      signal: result.signal,
      brdPath: brdPath || 'NOT FOUND',
      charCount,
    });

    assert.ok(brdPath, 'BRD markdown file must exist (checked specs/brd/brd.md and alternatives)');
    assert.ok(charCount > 200, `BRD must have > 200 chars (got ${charCount})`);
    BRD_PATH = brdPath;
    console.log(`[e2e] BRD found at: ${brdPath} (${charCount} chars)`);
  });

  // ── Stage 1b: BRD structural validation ─────────────────────────────────

  test('Stage 1b - BRD structural validation', { timeout: 5000 }, () => {
    if (!BRD_PATH) {
      logResult('stage-2b-brd-llm', { skipped: true, reason: 'BRD missing' });
      return;
    }

    const content = readArtifact(BRD_PATH);
    const requiredSections = ['Summary', 'Goal', 'Metric', 'Scope', 'Model'];
    const found = requiredSections.filter((s) => content.toLowerCase().includes(s.toLowerCase()));
    const missing = requiredSections.filter((s) => !content.toLowerCase().includes(s.toLowerCase()));

    logResult('stage-2b-brd-llm', { pass: missing.length === 0, found, missing });
    console.log(`[e2e] BRD sections: ${found.length}/${requiredSections.length} present`);
    if (missing.length > 0) console.log('[e2e]   Missing (advisory):', missing.join(', '));
  });

  // ── Stage 2: Spec ────────────────────────────────────────────────────────

  test('Stage 2 - Spec: decompose BRD into stories', { timeout: 120000 }, () => {
    if (!BRD_PATH) {
      console.log('[e2e] Skipping Spec: BRD not found');
      logResult('stage-3-spec', { skipped: true, reason: 'BRD missing' });
      return;
    }

    const brdContent = readArtifact(BRD_PATH);
    const specPrompt =
      'You MUST create the directory specs/stories/ using mkdir -p, then create ALL of the following files.\n\n' +
      '1. For each user story, write a file specs/stories/E1-S1.md, specs/stories/E1-S2.md, specs/stories/E1-S3.md etc. ' +
      'Each story file must contain: title, description, user story, 3-6 testable acceptance criteria, ' +
      'layer assignment, group assignment (A or B), readiness: ready.\n' +
      '2. Write specs/stories/epics.md with an epic index table.\n' +
      '3. Write specs/stories/dependency-graph.md with groups and dependencies.\n' +
      '4. Write a root features.json array where each feature has: id, category, story, group, description, steps, passes: false.\n\n' +
      'Decompose the following BRD into at least 3 user stories:\n\n' + brdContent.slice(0, 4000);
    const result = runClaude(specPrompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '0.75',
      timeoutMs: 110000,
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

  // ── Stage 2b: Spec structural validation ────────────────────────────────

  test('Stage 2b - Spec structural validation', { timeout: 5000 }, () => {
    const storyFiles = findFilesInProject('specs/stories', /^E\d+-S\d+.*\.md$/);
    if (storyFiles.length === 0) {
      console.log('[e2e] Skipping Spec validation: no story files found');
      logResult('stage-3b-spec-llm', { skipped: true, reason: 'no story files' });
      return;
    }

    const requiredFields = ['acceptance criteria', 'story', 'group'];
    let allValid = true;
    for (const f of storyFiles) {
      const content = fs.readFileSync(f, 'utf8').toLowerCase();
      for (const field of requiredFields) {
        if (!content.includes(field)) {
          console.log(`[e2e] ${path.basename(f)} missing: ${field}`);
          allValid = false;
        }
      }
    }

    logResult('stage-3b-spec-llm', { pass: allValid, storyCount: storyFiles.length });
    console.log(`[e2e] Spec validation: ${allValid ? 'PASS' : 'FAIL'} (${storyFiles.length} stories)`);
  });

  // ── Stage 3: Design ──────────────────────────────────────────────────────

  test('Stage 3 - Design: generate architecture', { timeout: 120000 }, () => {
    const designPrompt =
      'You MUST create the directory specs/design/ using mkdir -p, then write ALL of these files:\n\n' +
      '1. specs/design/system-design.md — architecture overview for a Node.js CLI todo app\n' +
      '2. specs/design/api-contracts.md — CLI commands as interface (add, list, complete, delete)\n' +
      '3. specs/design/data-models.md — todo entity with id/text/completed/createdAt\n' +
      '4. specs/design/folder-structure.md — directory tree\n' +
      '5. specs/design/component-map.md — story to file mapping\n\n' +
      'Write all 5 files. Each can be short (10-30 lines).';
    const result = runClaude(designPrompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '0.50',
      timeoutMs: 110000,
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

  test('Stage 4 - Auto/Solo: autonomous build loop', { timeout: 180000 }, () => {
    const autoPrompt =
      'Create a Node.js CLI todo app. Write these files directly — do NOT read any other files first.\n\n' +
      'FILE 1: todo.js — CLI entry point that parses process.argv for commands: add <text>, list, complete <id>, delete <id>.\n' +
      'FILE 2: storage.js — module that reads/writes todos.json. Each todo: {id, text, completed, createdAt}.\n' +
      'FILE 3: tests/todo.test.js — basic test using node:test and node:assert.\n\n' +
      'Use only Node.js built-ins. Exit 0 on success, 1 on error. Start writing files immediately.';
    const result = runClaude(autoPrompt, {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '1.00',
      timeoutMs: 170000,
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

