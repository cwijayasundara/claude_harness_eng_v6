'use strict';

// Real git-hook integration for the commit-time half of `length-caps`.
//
// The pre-disk cap lives in pre-write-gate, a PreToolUse hook — so it only ever
// saw files written through Write/Edit. Six files crossed their cap on this
// branch by being written through a Bash heredoc instead, which that hook never
// sees. These tests drive the cap through `git commit`, the one choke point
// every write route shares, so a file that reaches disk by any means is still
// answerable to the same limit.

const assert = require('assert');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const ENV = { HARNESS_COVERAGE_GATE: 'off' };

const body = (n) => `${Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n')}\n`;

function commitSeed(projectDir) {
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir });
}

test('a NEW source file over the 300-line cap BLOCKs at commit', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'big.js', body(320));
  const r = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(r.status, 1, `expected a block, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /length-caps/);
  assert.match(r.stdout + r.stderr, /big\.js: new -> 32[01] lines \(cap 300\)/);
});

test('a test file gets the 500-line cap, not the source cap', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'a.test.js', body(400));
  const ok = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(ok.status, 0,
    `400 lines is under the test cap and must pass:\n${ok.stdout}${ok.stderr}`);

  const projectDir2 = makeGitProject();
  stage(projectDir2, 'a.test.js', body(520));
  const blocked = await runGitHook(projectDir2, HOOK, ENV);
  assert.strictEqual(blocked.status, 1, 'a test file over 500 lines must still block');
  assert.match(blocked.stdout + blocked.stderr, /a\.test\.js: new -> 52[01] lines \(cap 500\)/);
});

test('it is a RATCHET: a file already over the cap stays committable', async () => {
  const projectDir = makeGitProject();
  // Seed an over-cap file directly through git, the way pre-existing debt got there.
  stage(projectDir, 'legacy.js', body(400));
  execFileSync('git', ['commit', '-q', '-m', 'seed', '--no-verify'], { cwd: projectDir });
  // Edit it WITHOUT growing it.
  stage(projectDir, 'legacy.js', body(400).replace('const v0 = 0;', 'const v0 = 1;'));
  const r = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(r.status, 0,
    `pre-existing debt must stay committable, got ${r.status}:\n${r.stdout}${r.stderr}`);
});

test('growing a file that is ALREADY over the cap BLOCKs', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'legacy.js', body(400));
  execFileSync('git', ['commit', '-q', '-m', 'seed', '--no-verify'], { cwd: projectDir });
  stage(projectDir, 'legacy.js', body(420));
  const r = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(r.status, 1, 'a file over the cap must not be allowed to grow further');
  assert.match(r.stdout + r.stderr, /legacy\.js: 40[01] -> 42[01] lines \(cap 300\)/);
});

test('an under-cap file commits cleanly', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'small.js', body(50));
  const r = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /length-caps/);
});
