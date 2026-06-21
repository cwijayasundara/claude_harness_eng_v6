'use strict';

// Live e2e — MODE 1: local full-auto from a PRD. `/build --auto` runs the whole
// pipeline (plan → build → deploy → test → fix) with ZERO human gates. In a temp
// repo there is no remote, so the Phase 11 PR step is the boundary; success here =
// the autonomous build completes and the generated project's own suite is green.
// Per-cluster PR fan-out (--pod) needs a real remote/merge and is validated in
// the distributed (symphony) path, not locally.
//
// LIVE: runs real `claude -p`, costs tokens, NOT in `npm test`. Run: `npm run test:auto`.

const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');
const { summarizeSpecs, formatSummary } = require('./helpers/specs-summary');
const { freshProject } = require('./helpers/fresh-project');

const PROJECT_DIR = path.join(__dirname, 'auto-output');
const PRD = path.join(__dirname, 'fixtures', 'counter-prd.md');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const SESSION = 'aaaa0001-0000-4000-8000-000000000001'; // claude --session-id requires a valid UUID

test('full-auto: PRD -> autonomous plan + build, zero human gates, suite green', { timeout: 2700000 }, (t) => {
  freshProject(PROJECT_DIR, PRD);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold', { ...opts, budgetUsd: '2.00', timeoutMs: 300000 });
  console.log('[auto] scaffold exit:', scaffold.exitCode);

  const build = runClaude('/build --auto prd.md', { ...opts, continueSession: true, budgetUsd: '20.00', timeoutMs: 2400000 });
  console.log('[auto] build --auto exit:', build.exitCode, 'signal:', build.signal);

  const summary = summarizeSpecs(PROJECT_DIR);
  t.after(() => console.log('[auto]\n' + formatSummary(PROJECT_DIR, summary) + '\n→ artifacts: ' + PROJECT_DIR));

  // Floor: the autonomous run must have planned (no human gate stopped it).
  assert.strictEqual(summary.present.brd, true, 'autonomous planning produced a BRD');
  assert.ok(summary.clusters >= 1, `planning produced clusters (got ${summary.clusters})`);

  // Goal: the generated app builds and its own tests pass — the independent oracle.
  const suite = runProjectSuite(PROJECT_DIR);
  console.log('[auto] generated project suite status:', suite.status);
  assert.strictEqual(suite.status, 0, `generated project suite must pass:\n${suite.out}`);
});
