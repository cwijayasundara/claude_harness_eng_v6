'use strict';

// Live e2e — MODE 1: local full-auto, FAST path (< ~20 min). `/build --auto`
// (zero human gates) over the compressed `--lite` lane and `--mode lean` (skip the
// GAN loop) on a trivial CLI — no server, so no deploy/browser overhead. Success =
// the generated app's own test suite is green: PRD-shaped intent -> working,
// tested code, fully autonomous, in one headless call.
//
// (The full --auto pipeline on a multi-story PRD needs session chaining across
// context windows — harness-plan-only proves the planning half headless.)
//
// LIVE: real `claude -p`, costs tokens, NOT in `npm test`. Run: `npm run test:auto`.

const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');
const { freshProject } = require('./helpers/fresh-project');

const PROJECT_DIR = path.join(__dirname, 'auto-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const SESSION = 'aaaa0001-0000-4000-8000-000000000001'; // claude --session-id requires a valid UUID
const APP = 'a Node.js CLI in index.js that reads two integer command-line arguments and prints their sum to stdout, with an npm test that runs it and checks the output';

test('full-auto (lite/lean): trivial CLI -> autonomous build, zero gates, suite green', { timeout: 1500000 }, (t) => {
  freshProject(PROJECT_DIR, null);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold', { ...opts, budgetUsd: '2.00', timeoutMs: 240000 });
  console.log('[auto] scaffold exit:', scaffold.exitCode);

  // Full-auto over the compressed lane: zero gates, no GAN loop, trivial scope.
  const build = runClaude(`/build --auto --mode lean --lite ${APP}`, { ...opts, continueSession: true, budgetUsd: '10.00', timeoutMs: 1080000 });
  console.log('[auto] build exit:', build.exitCode, 'signal:', build.signal);

  t.after(() => console.log('[auto] artifacts: ' + PROJECT_DIR));

  // The independent oracle: the generated app's own suite passes.
  const suite = runProjectSuite(PROJECT_DIR);
  console.log('[auto] generated project suite status:', suite.status);
  assert.strictEqual(suite.status, 0, `generated project suite must pass:\n${suite.out}`);
});
