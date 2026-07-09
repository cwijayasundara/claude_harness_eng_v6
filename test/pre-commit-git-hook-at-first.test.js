'use strict';

// Real git-hook integration for gap G23 (at-first-proof). Mirrors
// test/pre-commit-git-hook-legacy-discipline.test.js: the sensor script is
// lazy-required and no-ops without its prerequisite artifact, so a fixture
// project must install the script explicitly (makeGitProject() does not copy
// .claude/scripts).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const MAP = '# Component Map\n\n| Story | Files |\n|---|---|\n| E1-S1 | `src/legacy.py` |\n';

function installAtFirstScripts(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['at-first-gate.js', 'ownership-check.js']) {
    fs.copyFileSync(path.join(__dirname, '..', '.claude', 'scripts', name), path.join(dir, name));
  }
}

function writeMap(projectDir) {
  const p = path.join(projectDir, 'specs', 'design', 'component-map.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, MAP);
}

function writeAt(projectDir, name) {
  const dir = path.join(projectDir, 'specs', 'test_artefacts', 'acceptance');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '// at\n');
}

function writeReceipt(projectDir, row) {
  const p = path.join(projectDir, 'specs', 'reviews', 'at-red-receipts.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(row) + '\n');
}

test('at-first: silent no-op when no component-map.md exists', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('at-first-proof'), result.stdout);
});

test('at-first: blocks a NEW production file whose story has no AT file at all', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  writeMap(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('at-first-proof'), result.stdout);
  assert.ok(result.stdout.includes('E1-S1'), result.stdout);
});

test('at-first: blocks a NEW production file whose story has an AT file but no red receipt', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  writeMap(projectDir);
  writeAt(projectDir, 'E1-S1.spec.ts');
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('NO RED RECEIPT'), result.stdout);
});

test('at-first: passes when the AT file and matching receipt are both staged/present', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  writeMap(projectDir);
  writeAt(projectDir, 'E1-S1.spec.ts');
  writeReceipt(projectDir, {
    storyId: 'E1-S1',
    atPath: 'specs/test_artefacts/acceptance/E1-S1.spec.ts',
    observedRedAt: '2026-07-08T00:00:00Z',
    testCmd: 'x',
  });
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('at-first: a MODIFIED (not new) file is exempt even with no AT/receipt', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  writeMap(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const { execFileSync } = require('child_process');
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir });
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('at-first: a new file with no story owner in component-map.md is not this gate\'s concern', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  writeMap(projectDir);
  stage(projectDir, 'src/rogue/backdoor.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off', HARNESS_OWNERSHIP_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('at-first: HARNESS_AT_FIRST_GATE=off skips loudly', async () => {
  const projectDir = makeGitProject();
  installAtFirstScripts(projectDir);
  writeMap(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off', HARNESS_AT_FIRST_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('HARNESS_AT_FIRST_GATE=off'), result.stdout);
});
