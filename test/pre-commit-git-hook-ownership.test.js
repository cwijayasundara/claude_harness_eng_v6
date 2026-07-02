'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';

function installOwnershipScript(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'ownership-check.js'),
    path.join(dir, 'ownership-check.js')
  );
}

function writeMap(projectDir, text) {
  const p = path.join(projectDir, 'specs', 'design', 'component-map.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

test('ownership: silent no-op when no component-map.md exists', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('ownership'), result.stdout);
});

test('ownership: passes when every staged source file is owned', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('ownership: blocks an unowned staged source file, naming it', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  stage(projectDir, 'src/rogue/extra.py', 'Y = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('src/rogue/extra.py'), result.stdout);
  assert.ok(result.stdout.includes('component-map'), result.stdout);
});

test('ownership: HARNESS_OWNERSHIP_GATE=off skips loudly', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/rogue/extra.py', 'Y = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off', HARNESS_OWNERSHIP_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED'), result.stdout);
  assert.ok(result.stdout.includes('ownership'), result.stdout);
});

test('ownership: announces the skip when the map exists but the sensor script is missing', async () => {
  const projectDir = makeGitProject();
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED'), result.stdout);
  assert.ok(result.stdout.includes('ownership'), result.stdout);
});
