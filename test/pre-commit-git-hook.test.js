const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');

const HOOK = 'pre-commit';

function stage(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  execFileSync('git', ['add', rel], { cwd: projectDir });
  return p;
}

test('exits 0 when nothing source-like is staged', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'README.md', '# docs only\n');
  const result = await runGitHook(projectDir, HOOK);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('blocks a staged Python layer violation', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/repository/db.py', 'from src.service import logic\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(
    (result.stdout + result.stderr).includes('repository cannot import from service'),
    result.stdout + result.stderr
  );
});

test('blocks when a sprint contract exists without a PASS verdict', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  fs.writeFileSync(path.join(projectDir, 'claude-progress.txt'), 'current_group: group-01\n');
  fs.mkdirSync(path.join(projectDir, 'sprint-contracts'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'sprint-contracts', 'group-01.json'), '{}');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok((result.stdout + result.stderr).includes('Sprint contract'), result.stdout + result.stderr);
});

test('passes when the sprint contract has a PASS verdict', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  fs.writeFileSync(path.join(projectDir, 'claude-progress.txt'), 'current_group: group-01\n');
  fs.mkdirSync(path.join(projectDir, 'sprint-contracts'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'sprint-contracts', 'group-01.json'), '{}');
  fs.mkdirSync(path.join(projectDir, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'evaluator-report.md'), 'VERDICT: PASS\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('coverage gate fails open when the toolchain is unprovisioned', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  fs.mkdirSync(path.join(projectDir, 'tests'), { recursive: true });
  // PATH with git/sh but no uv/pytest — the gate must skip, not block.
  const result = await runGitHook(projectDir, HOOK, { PATH: '/usr/bin:/bin' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('respects HARNESS_COVERAGE_GATE=off', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  fs.mkdirSync(path.join(projectDir, 'tests'), { recursive: true });
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});
