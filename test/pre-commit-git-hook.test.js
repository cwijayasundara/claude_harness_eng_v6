const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage, VALID_CONTRACT, installContractSchema, armContractGate } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';

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

test('passes when the contract is valid, evaluator PASSed, and the security verdict PASSed', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  installContractSchema(projectDir);
  armContractGate(projectDir, VALID_CONTRACT);
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'security-verdict.json'), '{"verdict":"PASS"}');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('blocks when the sprint contract fails schema validation', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  installContractSchema(projectDir);
  armContractGate(projectDir, '{"group": "group-01"}'); // missing stories/features/contract
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('schema validation'), result.stdout);
  assert.ok(result.stdout.includes('stories'), result.stdout);
});

test('blocks when the security verdict is missing even though the evaluator report PASSed', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  installContractSchema(projectDir);
  armContractGate(projectDir, VALID_CONTRACT); // no security-verdict.json written
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('security gate'), result.stdout);
});

test('a FAIL security verdict does not clear the gate', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  installContractSchema(projectDir);
  armContractGate(projectDir, VALID_CONTRACT);
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'security-verdict.json'), '{"verdict":"FAIL","pass":false}');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('security gate'), result.stdout);
});

test('coverage gate fails open when the toolchain is unprovisioned', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  fs.mkdirSync(path.join(projectDir, 'tests'), { recursive: true });
  // PATH with git/sh but no uv/pytest — the gate must skip, not block.
  const result = await runGitHook(projectDir, HOOK, { PATH: '/usr/bin:/bin' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  // ...but the skip must be announced, never silent (a silent skip reads as a pass).
  assert.ok(
    /GATE SKIPPED.*coverage/i.test(result.stdout + result.stderr),
    `expected a loud skip notice, got: ${result.stdout + result.stderr}`
  );
});

test('respects HARNESS_COVERAGE_GATE=off', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  fs.mkdirSync(path.join(projectDir, 'tests'), { recursive: true });
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('refactor commits may not touch test or snapshot files', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.py', 'X = 1\n');
  stage(projectDir, 'tests/__snapshots__/logic.ambr', '# serializer: ambr\n');
  const result = await runGitHook(projectDir, HOOK, {
    HARNESS_COMMIT_KIND: 'refactor',
    HARNESS_COVERAGE_GATE: 'off',
  });
  assert.notStrictEqual(result.status, 0);
  assert.ok(
    /refactor commit/i.test(result.stdout + result.stderr),
    result.stdout + result.stderr
  );
});

test('refactor purity gate ignores behavior commits and unset kind', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.py', 'X = 1\n');
  stage(projectDir, 'tests/test_logic.py', 'def test_x():\n    assert True\n');
  const unset = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(unset.status, 0, unset.stdout + unset.stderr);
  const behavior = await runGitHook(projectDir, HOOK, {
    HARNESS_COMMIT_KIND: 'behavior',
    HARNESS_COVERAGE_GATE: 'off',
  });
  assert.strictEqual(behavior.status, 0, behavior.stdout + behavior.stderr);
});

test('a crashed gate fails open with a loud stderr warning, not silently', async () => {
  // Run the hook outside a git repo: stagedFiles() throws inside the
  // top-level try, exercising the fail-open path.
  const { makeHookProject, REPO_ROOT } = require('./helpers/hook-fixture');
  const projectDir = makeHookProject([]);
  fs.cpSync(path.join(REPO_ROOT, '.claude', 'git-hooks'), path.join(projectDir, '.claude', 'git-hooks'), {
    recursive: true,
  });
  const result = await runGitHook(projectDir, HOOK);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(/WARNING:.*pre-commit.*(crash|skip)/i.test(result.stderr), `expected loud warning, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('hook-errors.log'), result.stderr);
  const log = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'hook-errors.log'), 'utf8');
  assert.ok(log.includes('pre-commit:'), log);
});

test('layer gate honors a manifest-configured topology', async () => {
  const projectDir = makeGitProject();
  fs.writeFileSync(path.join(projectDir, 'project-manifest.json'),
    JSON.stringify({ architecture: { layers: ['domain', 'handlers'], layer_roots: ['app'] } }));
  stage(projectDir, 'app/domain/user.py', 'from app.handlers import router\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('domain cannot import from handlers'), result.stdout);
});

test('layer gate now also checks staged JS/TS files', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/repository/userRepo.js', "const { svc } = require('../service/logic');\n");
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('repository cannot import from service'), result.stdout);
});

test('advisory (non-blocking) when the layer gate matches no staged source', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'lib/util/strings.js', 'module.exports = (s) => s.trim();\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('layer gate matched no staged file'), result.stdout);
});

// verification-matrix backstop tests live in ./pre-commit-git-hook-matrix.test.js
// (split out to stay under the 300-line SRP file-size gate).
