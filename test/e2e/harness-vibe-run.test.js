'use strict';

// Live e2e: `/vibe` on an existing codebase. The controlled-vibe-coding lane is
// a primary user entry point that, until now, was only verified to be *copied*
// by scaffold — never actually driven. This proves the lane end to end on a
// small, low-risk change (exactly its eligibility envelope): scaffold an
// existing repo, run `/vibe`, and assert three things that distinguish a real
// vibe run from a no-op:
//   1. the change landed in the source,
//   2. the vibe lane recorded its micro-contract in .claude/state/vibe-log.md
//      (the lane-specific receipt — this is what separates /vibe from /change),
//   3. the project's own suite stays green (the deterministic oracle).
//
// Runs LIVE `claude -p` and costs tokens, so it is NOT part of `npm test`; run it
// with `npm run test:e2e:live --only vibe`. The cheap static contract lives in
// ../e2e-route-matrix-contract.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');

const PROJECT_DIR = path.join(__dirname, 'vibe-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const { randomUUID } = require('crypto');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION = randomUUID();

// A tiny calculator module with its own passing suite — same minimal existing
// repo as the feature route. /vibe extends it with one narrow function.
const CALC_SRC = [
  "'use strict';",
  '',
  'function add(a, b) {',
  '  return Number(a) + Number(b);',
  '}',
  '',
  'module.exports = { add };',
  '',
].join('\n');

const CALC_TEST = [
  "'use strict';",
  '',
  "const assert = require('assert');",
  "const { test } = require('node:test');",
  "const { add } = require('../calc');",
  '',
  "test('adds numbers', () => {",
  '  assert.strictEqual(add(2, 3), 5);',
  '});',
  '',
].join('\n');

function seedExistingProject(resolved) {
  fs.mkdirSync(path.join(resolved, 'test'), { recursive: true });
  fs.writeFileSync(path.join(resolved, 'package.json'), `${JSON.stringify({
    scripts: { test: 'node --test' },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(resolved, 'calc.js'), CALC_SRC);
  fs.writeFileSync(path.join(resolved, 'test', 'calc.test.js'), CALC_TEST);
  execFileSync('git', ['init'], { cwd: resolved, stdio: 'ignore' });
}

// Confinement guard: never rm a path outside this package.
function resetExistingProject() {
  const resolved = path.resolve(PROJECT_DIR);
  if (!resolved.startsWith(__dirname + path.sep)) {
    throw new Error(`refusing to wipe ${resolved}: outside ${__dirname}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  seedExistingProject(resolved);
}

test('vibe: existing repo -> /vibe lands a low-risk change, logs a micro-contract, keeps suite green', { timeout: 900000 }, (t) => {
  resetExistingProject();
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold --yes existing small Node library with calculator behavior and tests', {
    ...opts,
    budgetUsd: '3.00',
    timeoutMs: 300000,
  });
  console.log('[vibe] scaffold exit:', scaffold.exitCode);

  const result = runClaude('/vibe add a subtract(a, b) function exported from calc.js and covered by node:test; keep add(a, b) unchanged', {
    ...opts,
    continueSession: true,
    budgetUsd: '4.00',
    timeoutMs: 420000,
  });
  console.log('[vibe] vibe exit:', result.exitCode, 'signal:', result.signal);

  t.after(() => console.log('[vibe] artifacts: ' + PROJECT_DIR));

  // 1. The change landed in the existing module, without disturbing add().
  const source = fs.readFileSync(path.join(PROJECT_DIR, 'calc.js'), 'utf8');
  assert.match(source, /subtract/, '/vibe must add subtract to the existing module');
  assert.match(source, /function add\b|add\b.*=>/, '/vibe must keep the existing add() intact');

  // 2. The vibe lane recorded its micro-contract. This is the lane-specific
  //    receipt: /change does not write here, so a populated vibe-log proves the
  //    controlled-vibe path actually ran (not some other route).
  const vibeLog = path.join(PROJECT_DIR, '.claude', 'state', 'vibe-log.md');
  assert.ok(fs.existsSync(vibeLog), '/vibe must append a micro-contract to .claude/state/vibe-log.md');
  const log = fs.readFileSync(vibeLog, 'utf8');
  assert.match(log, /subtract|subtraction/i, 'the vibe-log micro-contract must describe the subtract change');

  // 3. The generated suite (now covering subtract) is the deterministic oracle.
  const suite = runProjectSuite(PROJECT_DIR);
  assert.strictEqual(suite.status, 0, `project suite must stay green:\n${suite.out}`);
});
