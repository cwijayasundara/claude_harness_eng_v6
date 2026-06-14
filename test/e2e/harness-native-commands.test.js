'use strict';

// E2E coverage for the native-command-integration changes:
//   - /refactor delegates its mechanical cleanup to native /simplify (Step 6),
//     fenced so behavior is preserved.
//   - /review was renamed to /gate; the renamed command must resolve and
//     produce the canonical blocking verdict (not Claude Code's native PR /review).
//
// Runs against the built project in test/e2e/output/, so it must execute AFTER
// harness-pipeline.test.js (greenfield build) — same sequential dependency as
// harness-brownfield.test.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, before } = require('node:test');
const { execFileSync } = require('child_process');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');

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
  fs.writeFileSync(path.join(RESULTS_DIR, stage + '.json'), JSON.stringify(data, null, 2));
}

function findSourceFiles() {
  const results = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', '.claude'].includes(entry.name)) walk(full);
      else if (entry.isFile() && /\.js$/.test(entry.name)) results.push(full);
    }
  };
  walk(PROJECT_DIR);
  return results.filter((f) => !f.includes('node_modules') && !f.includes('.claude') && !f.includes('specs'));
}

// runProjectSuite only knows the `npm test` script. Node-builtins projects test
// via `node --test` with no package.json — fall back to that so the
// behavior-preservation check still has an oracle. status null => no runnable
// suite at all (don't hard-fail on it).
function runSuite() {
  const suite = runProjectSuite(PROJECT_DIR);
  if (suite.status !== null) return suite;
  // Clear NODE_TEST_CONTEXT so the child `node --test` does not hit the parent
  // runner's recursion guard ("skipping running files"), which would exit 0
  // without actually running anything — a vacuous pass.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const out = execFileSync('node', ['--test'], { cwd: PROJECT_DIR, encoding: 'utf8', timeout: 120000, env });
    return { status: 0, out: (out || '').slice(-2000) };
  } catch (e) {
    if (e.status === undefined || e.status === null) return { status: null, out: 'no runnable suite' };
    return { status: e.status, out: ((e.stdout || '') + (e.stderr || '')).slice(-2000) };
  }
}

describe('Harness E2E — Native command integration (/refactor→/simplify, /gate)', { timeout: 1200000 }, () => {

  before(() => {
    PROJECT_DIR = OUTPUT_DIR;
    if (!fs.existsSync(PROJECT_DIR)) {
      throw new Error('No output/ dir — run harness-pipeline.test.js first (sequential dependency)');
    }
    if (!fs.existsSync(path.join(PROJECT_DIR, '.git'))) {
      execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });
    }
  });

  // ── /refactor runs native /simplify and preserves behavior ────────────

  test('Refactor: native /simplify pass preserves behavior', { timeout: 300000 }, () => {
    const target = findSourceFiles()
      .filter((f) => !/\.(test|spec)\.js$/.test(f))
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    assert.ok(target, 'a non-test source file must exist to refactor');
    const rel = path.relative(PROJECT_DIR, target);

    const prompt =
      `This project is a git repo with a passing test suite. Use the harness /refactor workflow on ${rel} ` +
      'to improve code quality. Follow the refactor skill exactly, INCLUDING Step 6 — the native ' +
      '/simplify mechanical-cleanup pass — followed by the clean-code-reviewer. ' +
      'This is a behavior-preserving refactor: do NOT change observable behavior, and every existing ' +
      'test must still pass. Commit the result as a pure refactor (HARNESS_COMMIT_KIND=refactor).';
    const result = runClaude(prompt, { cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '2.00', timeoutMs: 290000 });

    // The runtime guarantee that matters: behavior preserved (suite green).
    // Whether /simplify changed anything and whether a refactor commit landed
    // is logged, not hard-asserted — an already-clean file legitimately leaves
    // /simplify nothing to do.
    const suite = runSuite();
    const mentionedSimplify = /simplify/i.test(result.stdout || '');
    let refactorCommit = false;
    try {
      const log = execFileSync('git', ['log', '--format=%B', '-n', '20'], { cwd: PROJECT_DIR, encoding: 'utf8' });
      refactorCommit = /refactor/i.test(log);
    } catch (_) { /* no commits yet */ }

    logResult('stage-6d-refactor-simplify', {
      exitCode: result.exitCode, target: rel, suiteStatus: suite.status, mentionedSimplify, refactorCommit,
    });
    console.log(`[e2e] refactor ${rel}; suite exit: ${suite.status}; /simplify mentioned: ${mentionedSimplify}; refactor commit: ${refactorCommit}`);
    assert.strictEqual(result.exitCode, 0, 'refactor run must complete');
    if (suite.status === null) {
      console.log('[e2e] WARN: project has no runnable test suite — behavior-preservation check skipped');
    } else {
      assert.strictEqual(suite.status, 0, `behavior must be preserved — all tests pass after refactor:\n${suite.out}`);
    }
  });

  // ── /gate (renamed from /review) writes the canonical verdict ─────────

  test('Gate: /gate (renamed from /review) writes a security verdict', { timeout: 300000 }, () => {
    const verdictRel = 'specs/reviews/security-verdict.json';
    try { fs.rmSync(path.join(PROJECT_DIR, verdictRel)); } catch (_) { /* absent */ }

    const prompt =
      'Run the harness /gate command — the on-demand pre-merge quality gate, NOT GitHub PR review — ' +
      'on the most recent change in this repo. It must spawn the security-reviewer and write the ' +
      'canonical verdict to specs/reviews/security-verdict.json.';
    const result = runClaude(prompt, { cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '2.00', timeoutMs: 290000 });

    const verdictWritten = fileExists(verdictRel);
    let verdictValid = false;
    if (verdictWritten) {
      try { JSON.parse(readArtifact(verdictRel)); verdictValid = true; } catch (_) { /* malformed */ }
    }

    logResult('stage-6e-gate', { exitCode: result.exitCode, verdictWritten, verdictValid });
    console.log(`[e2e] /gate verdict written: ${verdictWritten}; valid JSON: ${verdictValid}`);
    assert.ok(verdictWritten, '/gate must write specs/reviews/security-verdict.json (proves the renamed command resolved, not native PR /review)');
    assert.ok(verdictValid, 'the security verdict must be valid JSON');
  });
});
