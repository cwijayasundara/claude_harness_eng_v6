'use strict';

// Live e2e: full `/build --auto` route, intentionally WITHOUT `--lite`.
// Uses a one-story PRD so the full route stays bounded while still proving the
// non-lite autonomous path can scaffold, plan, build, and leave a runnable app.

const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');
const { freshProject } = require('./helpers/fresh-project');

const PROJECT_DIR = path.join(__dirname, 'full-auto-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const PRD = path.join(__dirname, 'fixtures', 'counter-prd.md');
const SESSION = 'aaaa0005-0000-4000-8000-000000000005';

test('full-auto: /build --auto prd.md runs the non-lite route and leaves a green project', { timeout: 2100000 }, (t) => {
  freshProject(PROJECT_DIR, PRD);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold', { ...opts, budgetUsd: '2.00', timeoutMs: 240000 });
  console.log('[full-auto] scaffold exit:', scaffold.exitCode);

  const build = runClaude('/build --auto --mode lean prd.md', {
    ...opts,
    continueSession: true,
    budgetUsd: '12.00',
    timeoutMs: 1680000,
  });
  console.log('[full-auto] build exit:', build.exitCode, 'signal:', build.signal);

  t.after(() => console.log('[full-auto] artifacts: ' + PROJECT_DIR));

  const suite = runProjectSuite(PROJECT_DIR);
  console.log('[full-auto] generated project suite status:', suite.status);
  assert.strictEqual(suite.status, 0, `generated project suite must pass:\n${suite.out}`);
});
