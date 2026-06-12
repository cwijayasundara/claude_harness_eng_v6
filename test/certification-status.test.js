'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const STATUS_PATH = path.join(ROOT, '.claude', 'certification', 'status.json');
const REQUIRED_CAPABILITIES = [
  'greenfield_scaffold',
  'brownfield_adaptation',
  'real_workflow_e2e',
  'phase_evaluation',
  'end_user_usability',
  'multi_agent_claims',
];
const VALID_STATUSES = new Set(['proven', 'partially_proven', 'unproven']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('certification status declares every autonomous engineering proof area', () => {
  assert.ok(fs.existsSync(STATUS_PATH), '.claude/certification/status.json must exist');
  const status = readJson(STATUS_PATH);

  assert.strictEqual(status.schema_version, 1);
  assert.ok(status.generated_at, 'status must declare when it was generated or reviewed');
  assert.ok(status.summary, 'status must include a summary');
  assert.ok(status.capabilities, 'status must include capabilities');

  for (const capability of REQUIRED_CAPABILITIES) {
    const entry = status.capabilities[capability];
    assert.ok(entry, `missing capability: ${capability}`);
    assert.ok(VALID_STATUSES.has(entry.status), `${capability} has invalid status`);
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0, `${capability} needs evidence`);
    assert.ok(Array.isArray(entry.required_tests) && entry.required_tests.length > 0, `${capability} needs required tests`);
    assert.ok(entry.rationale, `${capability} needs rationale`);
  }
});

test('certification evidence and required tests point at real repository files', () => {
  const status = readJson(STATUS_PATH);

  for (const [capability, entry] of Object.entries(status.capabilities)) {
    for (const relPath of [...entry.evidence, ...entry.required_tests]) {
      assert.ok(
        fs.existsSync(path.join(ROOT, relPath)),
        `${capability} references missing file: ${relPath}`
      );
    }
  }
});

test('certification matrix is conservative about proof claims', () => {
  const status = readJson(STATUS_PATH);

  assert.strictEqual(status.capabilities.greenfield_scaffold.status, 'proven');
  assert.strictEqual(status.capabilities.brownfield_adaptation.status, 'partially_proven');
  assert.strictEqual(status.capabilities.real_workflow_e2e.status, 'partially_proven');
  assert.strictEqual(status.capabilities.phase_evaluation.status, 'proven');
  assert.strictEqual(status.capabilities.end_user_usability.status, 'partially_proven');
  assert.strictEqual(status.capabilities.multi_agent_claims.status, 'unproven');
  assert.match(status.capabilities.real_workflow_e2e.rationale, /live E2E/i);
});

test('certification report command summarizes the matrix', () => {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  assert.strictEqual(pkg.scripts.certification, 'node .claude/scripts/certification-report.js');

  const output = execFileSync('node', ['.claude/scripts/certification-report.js'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(output, /Certification Status/);
  assert.match(output, /greenfield_scaffold\s+proven/);
  assert.match(output, /multi_agent_claims\s+unproven/);
});
