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
// --- verification-matrix backstop (2026-07-02 audit fix #2) ---------------
function installMatrixGate(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'verification-matrix-gate.js'),
    path.join(dir, 'verification-matrix-gate.js')
  );
}
function writeFile(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function writeTraceArtifacts(projectDir) {
  writeFile(projectDir, 'specs/stories/story-traces.json', JSON.stringify([
    { id: 'S1', acs: ['AC-1'], traces: ['BRD-1'] },
  ]));
  writeFile(projectDir, 'specs/test_artefacts/unit-traces.json', JSON.stringify([
    { matrix_id: 'VM-1', path: 'tests/test_models.py' },
  ]));
  writeFile(projectDir, 'tests/test_models.py', 'def test_x():\n    assert True\n');
}
function writeSourceAndEvidence(projectDir) {
  writeFile(projectDir, 'src/types/models.py', 'X = 1\n');
  writeFile(projectDir, 'reports/unit-evidence.txt', 'PASS\n');
}
function buildMatrixJson(checkStatus) {
  return JSON.stringify({
    requirements: [{
      id: 'VM-1',
      ac_id: 'AC-1',
      story_id: 'S1',
      brd_id: 'BRD-1',
      group: 'group-01',
      required_layers: ['unit'],
      checks: [{
        id: 'chk-1',
        layer: 'unit',
        status: checkStatus,
        evidence: 'reports/unit-evidence.txt',
        implementation_paths: ['src/types/models.py'],
      }],
    }],
  });
}
function writeMatrixFile(projectDir, checkStatus) {
  writeFile(projectDir, 'specs/test_artefacts/verification-matrix.json', buildMatrixJson(checkStatus));
}
function applyStaleEvidence(projectDir) {
  const past = (Date.now() - 60 * 60 * 1000) / 1000;
  fs.utimesSync(path.join(projectDir, 'reports', 'unit-evidence.txt'), past, past);
  const now = Date.now() / 1000;
  fs.utimesSync(path.join(projectDir, 'src', 'types', 'models.py'), now, now);
}
function armMatrixGate(projectDir, { checkStatus = 'executed', staleEvidence = false } = {}) {
  writeTraceArtifacts(projectDir);
  writeSourceAndEvidence(projectDir);
  writeMatrixFile(projectDir, checkStatus);
  if (staleEvidence) applyStaleEvidence(projectDir);
}
function armGreenContractGate(projectDir) {
  installContractSchema(projectDir);
  armContractGate(projectDir, VALID_CONTRACT);
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'security-verdict.json'), '{"verdict":"PASS"}');
}
test('matrix backstop: passes when executed evidence is present and fresh', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  installMatrixGate(projectDir);
  armMatrixGate(projectDir);
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});
test('matrix backstop: blocks when a required check is not executed', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  installMatrixGate(projectDir);
  armMatrixGate(projectDir, { checkStatus: 'planned' });
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('verification matrix'), result.stdout);
  assert.ok(result.stdout.includes('missing_executed_evidence'), result.stdout);
});
test('matrix backstop: blocks stale evidence (older than its implementation path)', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  installMatrixGate(projectDir);
  armMatrixGate(projectDir, { staleEvidence: true });
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('stale_executed_evidence'), result.stdout);
});
test('matrix backstop: silent no-op when no matrix file exists', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('verification-matrix'), result.stdout);
});
test('matrix backstop: announces the skip when the matrix exists but the gate script is missing', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  armMatrixGate(projectDir);
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED'), result.stdout);
  assert.ok(result.stdout.includes('verification-matrix'), result.stdout);
});
