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
const OUTPUT_DIR = path.join(__dirname, 'output');
const CRITERIA = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'validation-criteria.json'), 'utf8')
);

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

describe('Harness E2E Pipeline', { timeout: 1200000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (fs.existsSync(PROJECT_DIR)) {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    console.log('[e2e] Project directory:', PROJECT_DIR);
    console.log('[e2e] Harness root:', HARNESS_ROOT);
  });

  after(() => {
    console.log('[e2e] Artifacts saved to:', PROJECT_DIR);
  });

  // ── Stage 1: BRD ──────────────────────────────────────────────────────────

  test('Stage 1 - BRD: generate business requirements', { timeout: 180000 }, () => {
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
      model: 'haiku',
      budgetUsd: '1.00',
      timeoutMs: 170000,
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

  // ── Stage 1b: BRD LLM validation (advisory) ─────────────────────────────

  test('Stage 1b - BRD LLM validation (advisory)', { timeout: 60000 }, () => {
    if (!BRD_PATH) {
      console.log('[e2e] Skipping BRD LLM validation: BRD not found');
      logResult('stage-2b-brd-llm', { skipped: true, reason: 'BRD missing' });
      return;
    }

    const fullBrdPath = path.join(PROJECT_DIR, BRD_PATH);
    const validation = llmValidate(fullBrdPath, CRITERIA.brd);

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

  // ── Stage 2: Spec ────────────────────────────────────────────────────────

  test('Stage 2 - Spec: decompose BRD into stories', { timeout: 180000 }, () => {
    if (!BRD_PATH) {
      console.log('[e2e] Skipping Spec: BRD not found');
      logResult('stage-3-spec', { skipped: true, reason: 'BRD missing' });
      return;
    }

    const brdContent = readArtifact(BRD_PATH);
    const specPrompt =
      'Read the BRD at ' + BRD_PATH + '. Decompose it into user stories. For each story create a file ' +
      'specs/stories/E1-S{N}.md with: title, description, user story, 3-6 testable acceptance criteria, ' +
      'layer assignment, group assignment (A or B), readiness: ready. ' +
      'Create specs/stories/epics.md with an epic index table. ' +
      'Create specs/stories/dependency-graph.md with groups and dependencies. ' +
      'Create a root features.json array where each feature has: id, category, story, group, description, steps, passes: false. ' +
      'Create specs/stories/ directory first.\n\nBRD content:\n' + brdContent.slice(0, 4000);
    const result = runClaude(specPrompt, {
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

  // ── Stage 2b: Spec LLM validation (advisory) ────────────────────────────

  test('Stage 2b - Spec LLM validation (advisory)', { timeout: 60000 }, () => {
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

  // ── Stage 3: Design ──────────────────────────────────────────────────────

  test('Stage 3 - Design: generate architecture', { timeout: 600000 }, () => {
    const designPrompt =
      'Read the story files in specs/stories/. Create design artifacts in specs/design/: ' +
      'system-design.md (architecture overview), api-contracts.md (CLI commands as interface), ' +
      'data-models.md (todo entity with id/text/completed/createdAt), ' +
      'folder-structure.md (directory tree), component-map.md (story to file mapping). ' +
      'Create the specs/design/ directory first.';
    const result = runClaude(designPrompt, {
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

  // ── Stage 4: Auto/Solo ───────────────────────────────────────────────────

  test('Stage 4 - Auto/Solo: autonomous build loop', { timeout: 600000 }, () => {
    const autoPrompt =
      'Read specs/design/ and specs/stories/ to understand the todo CLI project. ' +
      'Implement the Node.js CLI todo app based on the design. Create: ' +
      '1) The main entry point (todo.js or index.js) with add/list/complete/delete commands. ' +
      '2) A storage module that reads/writes todos.json. ' +
      '3) At least one test file. ' +
      'The CLI should work with: node todo.js add "buy milk", node todo.js list, etc. ' +
      'Use only Node.js built-ins (no npm dependencies). Make sure the entry file is executable.';
    const result = runClaude(autoPrompt, {
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

