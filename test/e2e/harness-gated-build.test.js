'use strict';

// Live e2e: default gated `/build prd.md` route. This should produce the first
// planning artifact and stop for human approval instead of silently running the
// autonomous tail.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { freshProject } = require('./helpers/fresh-project');

const PROJECT_DIR = path.join(__dirname, 'gated-build-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const PRD = path.join(__dirname, 'fixtures', 'counter-prd.md');
const SESSION = 'aaaa0006-0000-4000-8000-000000000006';

function exists(rel) {
  return fs.existsSync(path.join(PROJECT_DIR, rel));
}

test('gated build: /build prd.md stops at the first human approval gate', { timeout: 900000 }, (t) => {
  freshProject(PROJECT_DIR, PRD);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold', { ...opts, budgetUsd: '2.00', timeoutMs: 240000 });
  console.log('[gated] scaffold exit:', scaffold.exitCode);

  const build = runClaude('/build prd.md', {
    ...opts,
    continueSession: true,
    budgetUsd: '4.00',
    timeoutMs: 540000,
  });
  console.log('[gated] build exit:', build.exitCode, 'signal:', build.signal);

  t.after(() => console.log('[gated] artifacts: ' + PROJECT_DIR));

  assert.ok(exists('specs/brd/brd.md'), 'default /build must generate BRD artifact');
  assert.ok(!exists('claude-progress.txt'), 'default /build must not enter autonomous build before approval');
  assert.ok(!exists('features.json'), 'default /build must not silently proceed to story generation before approval');
});
