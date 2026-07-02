const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');

const HOOK = 'pre-commit';

function stage(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  const { execFileSync } = require('child_process');
  execFileSync('git', ['add', rel], { cwd: projectDir });
  return p;
}

const VALID_CONTRACT = JSON.stringify({
  group: 'group-01',
  stories: ['S1'],
  features: ['F1'],
  contract: { api_checks: [{ id: 'a1', method: 'GET', path: '/health', expected_status: 200 }] },
});

function installContractSchema(projectDir) {
  const dir = path.join(projectDir, '.claude', 'skills', 'evaluate', 'references');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json'),
    path.join(dir, 'contract-schema.json')
  );
}

function armContractGate(projectDir, contractJson) {
  fs.writeFileSync(path.join(projectDir, 'claude-progress.txt'), 'current_group: group-01\n');
  fs.mkdirSync(path.join(projectDir, 'sprint-contracts'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'sprint-contracts', 'group-01.json'), contractJson);
  fs.mkdirSync(path.join(projectDir, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'evaluator-report.md'), 'VERDICT: PASS\n');
}

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
