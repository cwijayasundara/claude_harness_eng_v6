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
const { randomUUID } = require('crypto');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION = randomUUID();

test('full-auto: /build --auto prd.md runs the non-lite route and leaves a green project', { timeout: 2100000 }, (t) => {
  freshProject(PROJECT_DIR, PRD);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude(
    '/scaffold --yes a minimal Node.js HTTP counter API from prd.md; API surface; no team integrations, no tracker, no framework packs',
    { ...opts, budgetUsd: '3.00', timeoutMs: 300000 },
  );
  console.log('[full-auto] scaffold exit:', scaffold.exitCode);
  assert.ok(
    require('fs').existsSync(path.join(PROJECT_DIR, 'project-manifest.json'))
      || require('fs').existsSync(path.join(PROJECT_DIR, 'CLAUDE.md')),
    'scaffold must install harness before /build',
  );

  // Explicit handoff text: progressive /build can otherwise stop after specs/.
  const build = runClaude(
    '/build --auto --mode lean prd.md\n\n' +
      'Headless iron law: after the plan (specs/brd, stories, design) exists, ' +
      'immediately run Phase 4 + /auto --mode lean until package.json and npm test exist and pass. ' +
      'Do not stop after planning; --plan-only was NOT requested.',
    {
      ...opts,
      continueSession: true,
      budgetUsd: '18.00',
      timeoutMs: 1800000,
    },
  );
  console.log('[full-auto] build exit:', build.exitCode, 'signal:', build.signal);

  t.after(() => console.log('[full-auto] artifacts: ' + PROJECT_DIR));

  // If planning finished but /auto never ran (budget / progressive-load miss),
  // one explicit /auto resume is allowed — proves the implement half still works.
  let suite = runProjectSuite(PROJECT_DIR);
  if (suite.status == null && require('fs').existsSync(path.join(PROJECT_DIR, 'features.json'))) {
    console.log('[full-auto] no package yet after /build — resume with /auto --mode lean');
    const resume = runClaude(
      '/auto --mode lean\nImplement all open groups until npm test passes. Do not replan.',
      { ...opts, continueSession: true, budgetUsd: '12.00', timeoutMs: 1200000 },
    );
    console.log('[full-auto] /auto resume exit:', resume.exitCode);
    suite = runProjectSuite(PROJECT_DIR);
  }
  console.log('[full-auto] generated project suite status:', suite.status);
  assert.strictEqual(suite.status, 0, `generated project suite must pass:\n${suite.out}`);
});
