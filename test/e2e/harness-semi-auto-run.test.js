'use strict';

// Live e2e — MODE 2: local semi-auto, `/build --autonomous` (plan-approve-once lane).
// HEADLESS NOTE: there is no human to pause for, so --autonomous builds directly —
// the approval *pause* is a human checkpoint that can't be exercised headless. The
// explicit "produce the plan, then STOP for review" half is validated by the
// plan-only harness; the gate's existence is contract-pinned in build/SKILL.md.
// Here we validate that the --autonomous lane builds a working app AND the
// extend-already-generated-code path (code-map via /brownfield + /change) works on it.
//
// LIVE: real `claude -p`, costs tokens, NOT in `npm test`. Run: `npm run test:semi`.

const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');
const { freshProject } = require('./helpers/fresh-project');
const { alterAndVerify } = require('./helpers/alter-and-verify');

const PROJECT_DIR = path.join(__dirname, 'semi-auto-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const { randomUUID } = require('crypto');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION = randomUUID();
const APP = 'a Node.js CLI in index.js that reads two integer command-line arguments and prints their sum to stdout, with an npm test that runs it and checks the output';

test('semi-auto: /build --autonomous -> build -> alter (code-map), suite green', { timeout: 1800000 }, (t) => {
  freshProject(PROJECT_DIR, null);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude(
    `/scaffold --yes ${APP}; CLI surface; no team integrations, no tracker, no framework packs`,
    { ...opts, budgetUsd: '3.00', timeoutMs: 300000 },
  );
  console.log('[semi] scaffold exit:', scaffold.exitCode);
  assert.ok(
    require('fs').existsSync(path.join(PROJECT_DIR, 'project-manifest.json'))
      || require('fs').existsSync(path.join(PROJECT_DIR, 'CLAUDE.md')),
    'scaffold must install harness before /build',
  );

  const build = runClaude(`/build --autonomous --lite ${APP}`, { ...opts, continueSession: true, budgetUsd: '10.00', timeoutMs: 1080000 });
  console.log('[semi] build exit:', build.exitCode, 'signal:', build.signal);

  const suite = runProjectSuite(PROJECT_DIR);
  console.log('[semi] suite after build:', suite.status);
  assert.strictEqual(suite.status, 0, `generated suite must pass after the --autonomous build:\n${suite.out}`);

  // Then ALTER — exercises /code-map + /brownfield on the generated code.
  const alter = alterAndVerify(runClaude, opts, {
    projectDir: PROJECT_DIR,
    changeDesc: 'extend the CLI: accept an optional third argument "op" of "add" or "sub"; "sub" prints a minus b, default stays add; update the tests',
  });
  t.after(() => console.log('[semi] code-graph:', alter.codeGraphExists, 'artifacts:', PROJECT_DIR));
  assert.ok(alter.codeGraphExists, 'code-map must produce specs/brownfield/code-graph.json');
  assert.strictEqual(alter.suite.status, 0, `suite must stay green after the alteration:\n${alter.suite.out}`);
});
