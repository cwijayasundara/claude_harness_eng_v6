'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'verification-matrix-gate.js');
const gate = require(SCRIPT);

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-gate-'));
  fs.mkdirSync(path.join(root, 'specs', 'test_artefacts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'stories'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sprint-contracts'), { recursive: true });
  return root;
}

function writeJson(root, rel, data) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

function writeText(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function baseProject() {
  const root = tmpProject();
  writeJson(root, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC1', 'E1-S1-AC2'] },
  ]);
  writeJson(root, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [
      {
        id: 'VM-001',
        brd_id: 'BR-1',
        story_id: 'E1-S1',
        ac_id: 'E1-S1-AC1',
        text: 'Create todo',
        group: 'A',
        required_layers: ['unit', 'api', 'e2e'],
        checks: [
          { id: 'UT-001', layer: 'unit', kind: 'test', path: 'tests/unit/todo.test.js', status: 'implemented' },
          { id: 'API-001', layer: 'api', kind: 'sprint-contract-check', path: 'sprint-contracts/A.json', status: 'implemented' },
          { id: 'E2E-001', layer: 'e2e', kind: 'playwright', path: 'e2e/E1-S1.spec.ts', status: 'implemented' },
        ],
      },
      {
        id: 'VM-002',
        brd_id: 'BR-1',
        story_id: 'E1-S1',
        ac_id: 'E1-S1-AC2',
        text: 'Reject invalid title',
        group: 'A',
        required_layers: ['unit'],
        checks: [
          { id: 'UT-002', layer: 'unit', kind: 'test', path: 'tests/unit/todo.test.js', status: 'implemented' },
        ],
      },
    ],
  });
  writeJson(root, 'sprint-contracts/A.json', {
    api_checks: [{ id: 'api-create', matrix_ids: ['VM-001'], method: 'POST', path: '/todos', expect: { status: 201 } }],
    playwright_checks: [{ id: 'e2e-create', matrix_ids: ['VM-001'], name: 'create todo flow', steps: [] }],
    design_checks: [],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  });
  writeJson(root, 'specs/test_artefacts/unit-traces.json', [
    { id: 'UT-001', matrix_id: 'VM-001', test_name: 'creates todo', path: 'tests/unit/todo.test.js' },
    { id: 'UT-002', matrix_id: 'VM-002', test_name: 'rejects invalid title', path: 'tests/unit/todo.test.js' },
  ]);
  writeJson(root, 'specs/test_artefacts/e2e-traces.json', [
    { id: 'E2E-001', matrix_id: 'VM-001', test_name: 'creates todo through UI', path: 'e2e/E1-S1.spec.ts' },
  ]);
  writeText(root, 'tests/unit/todo.test.js', 'test("creates todo", () => {});\n');
  writeText(root, 'e2e/E1-S1.spec.ts', 'test("VM-001 creates todo", async () => {});\n');
  writeText(root, 'specs/reviews/evaluator-report.md', '# Evaluator Report\n\nVERDICT: PASS\n');
  return root;
}

test('plan phase passes a matrix covering every implementation-ready AC', () => {
  const root = baseProject();
  const verdict = gate.runGate({ root, phase: 'plan' });
  assert.strictEqual(verdict.pass, true);
  assert.deepStrictEqual(verdict.failures, []);
});

test('plan phase fails when an AC has no matrix obligation', () => {
  const root = baseProject();
  writeJson(root, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC1', 'E1-S1-AC2', 'E1-S1-AC3'] },
  ]);
  const verdict = gate.runGate({ root, phase: 'plan' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_matrix_obligation' && f.ac_id === 'E1-S1-AC3'));
});

test('contract phase fails when required API coverage has no contract check', () => {
  const root = baseProject();
  writeJson(root, 'sprint-contracts/A.json', {
    api_checks: [],
    playwright_checks: [{ id: 'e2e-create', matrix_ids: ['VM-001'], name: 'create todo flow', steps: [] }],
    design_checks: [],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  });
  const verdict = gate.runGate({ root, phase: 'contract', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_contract_layer' && f.matrix_id === 'VM-001' && f.layer === 'api'));
});

test('contract phase fails when a contract check references an unknown matrix id', () => {
  const root = baseProject();
  writeJson(root, 'sprint-contracts/A.json', {
    api_checks: [{ id: 'api-create', matrix_ids: ['VM-999'], method: 'POST', path: '/todos', expect: { status: 201 } }],
    playwright_checks: [],
    design_checks: [],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  });
  const verdict = gate.runGate({ root, phase: 'contract', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'unknown_matrix_id' && f.matrix_id === 'VM-999'));
});

test('implementation phase fails when a required unit trace is missing', () => {
  const root = baseProject();
  writeJson(root, 'specs/test_artefacts/unit-traces.json', [
    { id: 'UT-001', matrix_id: 'VM-001', test_name: 'creates todo', path: 'tests/unit/todo.test.js' },
  ]);
  const verdict = gate.runGate({ root, phase: 'implementation', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_trace' && f.matrix_id === 'VM-002' && f.layer === 'unit'));
});

test('implementation phase fails when a trace points to a missing test file', () => {
  const root = baseProject();
  fs.unlinkSync(path.join(root, 'tests/unit/todo.test.js'));
  const verdict = gate.runGate({ root, phase: 'implementation', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_artifact' && f.path === 'tests/unit/todo.test.js'));
});

test('executed phase fails when evaluator report is not PASS for API/E2E rows', () => {
  const root = baseProject();
  writeText(root, 'specs/reviews/evaluator-report.md', '# Evaluator Report\n\nVERDICT: FAIL\n');
  const verdict = gate.runGate({ root, phase: 'executed' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'evaluator_not_pass'));
});

test('CLI writes verdict JSON and exits 0 on pass', () => {
  const root = baseProject();
  execFileSync(process.execPath, [SCRIPT, '--phase', 'plan', '--root', root], { stdio: 'pipe' });
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/verification-matrix-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.pass, true);
});

test('CLI exits 1 on gate failure', () => {
  const root = baseProject();
  writeJson(root, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC9'] },
  ]);
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--phase', 'plan', '--root', root], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 1);
});
