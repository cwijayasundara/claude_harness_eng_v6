'use strict';

// Live e2e: default gated `/build prd.md` route. This should produce the first
// planning artifact and stop for human approval instead of silently running the
// autonomous tail.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');
const { randomUUID } = require('crypto');

const { runClaude } = require('./helpers/claude-runner');
const { freshProject } = require('./helpers/fresh-project');

const PROJECT_DIR = path.join(__dirname, 'gated-build-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const PRD = path.join(__dirname, 'fixtures', 'counter-prd.md');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION = randomUUID();

function exists(rel) {
  return fs.existsSync(path.join(PROJECT_DIR, rel));
}

test('gated build: /build prd.md stops at the first human approval gate', { timeout: 900000 }, (t) => {
  freshProject(PROJECT_DIR, PRD);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  // Non-interactive scaffold: interactive /scaffold only prints Q1 in claude -p
  // and may exit 0 with no files — same pattern as feature/smoke e2e.
  const scaffold = runClaude(
    '/scaffold --yes a minimal Node.js HTTP counter API from prd.md; API surface; no team integrations, no tracker, no framework packs',
    { ...opts, budgetUsd: '3.00', timeoutMs: 300000 },
  );
  console.log('[gated] scaffold exit:', scaffold.exitCode);
  assert.ok(
    exists('project-manifest.json') || exists('CLAUDE.md'),
    'scaffold must install harness (project-manifest.json or CLAUDE.md) before /build',
  );

  const build = runClaude('/build prd.md', {
    ...opts,
    continueSession: true,
    budgetUsd: '4.00',
    timeoutMs: 540000,
  });
  console.log('[gated] build exit:', build.exitCode, 'signal:', build.signal);

  t.after(() => console.log('[gated] artifacts: ' + PROJECT_DIR));

  assert.ok(exists('specs/brd/brd.md'), 'default /build must generate BRD artifact');
  // Scaffold may seed claude-progress.txt / features.json; gated /build must not
  // run the autonomous tail (no evaluator PASS report / sprint contracts filled).
  assert.ok(
    !exists('specs/reviews/eval-report.md') && !exists('.claude/state/auto-build'),
    'default /build must not enter autonomous build before approval',
  );
});
