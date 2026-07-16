'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const ENV = { HARNESS_COVERAGE_GATE: 'off' };

// A directly-constructed SDK client trips live-externals (kind: sdk-client) but
// NOT the earlier secret-scan gate, so the BLOCK is attributable to G36 rather
// than a URL literal that secret-scan would catch first.
const SDK_VIOLATION = 'client = Anthropic()\n';

function installScript(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'live-externals-gate.js'),
    path.join(dir, 'live-externals-gate.js')
  );
}
function seed(projectDir) { execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir }); }

test('live-externals: an integration test constructing a raw SDK client BLOCKs', async () => {
  const p = makeGitProject();
  installScript(p);
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_pay.py', SDK_VIOLATION);
  const r = await runGitHook(p, HOOK, ENV);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /live-externals \(G36\)/);
  assert.match(r.stdout + r.stderr, /RAW SDK/);
});

test('live-externals: a clean integration test passes', async () => {
  const p = makeGitProject();
  installScript(p);
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_ok.py', 'assert add(1, 2) == 3\n');
  const r = await runGitHook(p, HOOK, ENV);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('live-externals: HARNESS_LIVE_EXTERNALS_GATE=off skips loudly on a violating diff', async () => {
  const p = makeGitProject();
  installScript(p);
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_pay.py', SDK_VIOLATION);
  const r = await runGitHook(p, HOOK, { ...ENV, HARNESS_LIVE_EXTERNALS_GATE: 'off' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GATE SKIPPED — live-externals/);
});

test('live-externals: missing sensor script no-ops loudly rather than blocking', async () => {
  const p = makeGitProject(); // installScript intentionally NOT called
  stage(p, 'README.md', '# seed\n'); seed(p);
  stage(p, 'tests/integration/test_pay.py', SDK_VIOLATION);
  const r = await runGitHook(p, HOOK, ENV);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GATE SKIPPED — live-externals/);
});
