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

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');
const { randomUUID } = require('crypto');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');
const { freshProject } = require('./helpers/fresh-project');
const { alterAndVerify } = require('./helpers/alter-and-verify');

const PROJECT_DIR = path.join(__dirname, 'semi-auto-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION = randomUUID();
const APP = 'a Node.js CLI in index.js that reads two integer command-line arguments and prints their sum to stdout, with an npm test that runs it and checks the output';

function hasRootPackage() {
  return fs.existsSync(path.join(PROJECT_DIR, 'package.json'));
}

test('semi-auto: /build --autonomous -> build -> alter (code-map), suite green', { timeout: 2400000 }, (t) => {
  freshProject(PROJECT_DIR, null);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude(
    `/scaffold --yes ${APP}; CLI surface; no team integrations, no tracker, no framework packs`,
    { ...opts, budgetUsd: '3.00', timeoutMs: 300000 },
  );
  console.log('[semi] scaffold exit:', scaffold.exitCode);
  assert.ok(
    fs.existsSync(path.join(PROJECT_DIR, 'project-manifest.json'))
      || fs.existsSync(path.join(PROJECT_DIR, 'CLAUDE.md')),
    'scaffold must install harness before /build',
  );

  // Mirror the proven lite-auto path, but with --autonomous (one plan gate).
  // Headless: treat the plan as approved and finish with /auto --mode lean.
  const build = runClaude(
    `/build --autonomous --mode lean --lite ${APP}\n\n` +
      'Headless: no human at the plan-approval gate. After specs/ exist, treat the plan as APPROVED. ' +
      'Immediately run Phase 4 + /auto --mode lean until ALL of these exist at the project root: ' +
      'package.json (scripts.test runs node --test), index.js, and a test/ file. Then npm test must pass. ' +
      'Do not stop after planning.',
    { ...opts, continueSession: true, budgetUsd: '12.00', timeoutMs: 1080000 },
  );
  console.log('[semi] build exit:', build.exitCode, 'signal:', build.signal);

  let suite = runProjectSuite(PROJECT_DIR);
  if (suite.status == null) {
    console.log('[semi] no green suite yet — resume implement (package.json + tests)');
    const resume = runClaude(
      'Plan approved. Continue with /auto --mode lean (or implement directly if simpler).\n' +
        'Required at project root:\n' +
        '1) package.json with { "scripts": { "test": "node --test" } }\n' +
        '2) index.js CLI: two integer args, print their sum\n' +
        '3) test/ covering the CLI\n' +
        'Then run npm test until exit 0. Do not replan stories.',
      { ...opts, continueSession: true, budgetUsd: '10.00', timeoutMs: 900000 },
    );
    console.log('[semi] resume exit:', resume.exitCode, 'signal:', resume.signal);
    suite = runProjectSuite(PROJECT_DIR);
  }
  console.log('[semi] suite after build:', suite.status, 'hasPackage:', hasRootPackage());
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
