'use strict';

// Real git-hook integration for gap G31 (test-deletion-guard). Mirrors
// test/pre-commit-git-hook-sprout-diff.test.js's fixture shape: a fixture
// project must install the sensor script explicitly (makeGitProject does not
// copy .claude/scripts), but DOES copy the full .claude/hooks/lib tree, so
// tdd.js / test-deletion-gate.js's own hooks/lib dependency is already
// present.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const ENV = { HARNESS_COVERAGE_GATE: 'off' };

function commitSeed(projectDir) {
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir });
}

function installScript(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'test-deletion-gate.js'),
    path.join(dir, 'test-deletion-gate.js')
  );
}

function stageDelete(projectDir, rel) {
  fs.rmSync(path.join(projectDir, rel));
  execFileSync('git', ['add', rel], { cwd: projectDir });
}

test('test-deletion-guard: deleting a test file with live test cases BLOCKs', async () => {
  const projectDir = makeGitProject();
  installScript(projectDir);
  stage(projectDir, 'a.test.js', "it('a', () => {});\nit('b', () => {});\n");
  commitSeed(projectDir);
  stageDelete(projectDir, 'a.test.js');
  const result = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /test-deletion-guard \(G31\)/);
  assert.match(result.stdout + result.stderr, /TEST FILE DELETED\s+a\.test\.js/);
});

test('test-deletion-guard: shrinking a test file\'s test count BLOCKs', async () => {
  const projectDir = makeGitProject();
  installScript(projectDir);
  stage(projectDir, 'a.test.js', "it('a', () => {});\nit('b', () => {});\n");
  commitSeed(projectDir);
  stage(projectDir, 'a.test.js', "it('a', () => {});\n");
  const result = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /TEST COUNT DECREASED\s+a\.test\.js \(2 -> 1\)/);
});

test('test-deletion-guard: newly skipping a test without changing its count BLOCKs', async () => {
  // A pytest skip decorator sits ABOVE `def test_...`, so the function
  // signature still matches the test-marker regex — the count stays the
  // same, isolating the new-skip-marker signal from count-decreased (a JS
  // `it.skip(...)` instead unmatches the marker regex entirely, which is
  // covered as a count-decreased case by the "shrinking" test above).
  const projectDir = makeGitProject();
  installScript(projectDir);
  stage(projectDir, 'tests/test_a.py', 'def test_a():\n    assert True\n');
  commitSeed(projectDir);
  stage(projectDir, 'tests/test_a.py', '@pytest.mark.skip\ndef test_a():\n    assert True\n');
  const result = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /NEW SKIP MARKER\s+tests\/test_a\.py/);
});

test('test-deletion-guard: adding tests, or unrelated changes, pass clean', async () => {
  const projectDir = makeGitProject();
  installScript(projectDir);
  stage(projectDir, 'a.test.js', "it('a', () => {});\n");
  stage(projectDir, 'src/prod.js', 'module.exports = { a: 1 };\n');
  commitSeed(projectDir);
  stage(projectDir, 'a.test.js', "it('a', () => {});\nit('b', () => {});\n");
  stage(projectDir, 'src/prod.js', 'module.exports = { a: 2 };\n');
  const result = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /test-deletion-guard/);
});

test('test-deletion-guard: HARNESS_TEST_DELETION_GATE=off skips loudly even on a violating diff', async () => {
  const projectDir = makeGitProject();
  installScript(projectDir);
  stage(projectDir, 'a.test.js', "it('a', () => {});\n");
  commitSeed(projectDir);
  stageDelete(projectDir, 'a.test.js');
  const result = await runGitHook(projectDir, HOOK, { ...ENV, HARNESS_TEST_DELETION_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /GATE SKIPPED — test-deletion-guard/);
});

test('test-deletion-guard: missing sensor script no-ops loudly rather than blocking the commit', async () => {
  const projectDir = makeGitProject(); // installScript() intentionally not called
  stage(projectDir, 'a.test.js', "it('a', () => {});\n");
  commitSeed(projectDir);
  stageDelete(projectDir, 'a.test.js');
  const result = await runGitHook(projectDir, HOOK, ENV);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /GATE SKIPPED — test-deletion-guard/);
});
