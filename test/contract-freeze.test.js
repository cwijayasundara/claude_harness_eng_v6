'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePlan } = require('../.claude/scripts/test-plan-write');
const {
  freeze, verifyFreeze, parseApiObserve, parsePwObserve, run,
} = require('../.claude/scripts/contract-freeze');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contract-freeze-'));
}

const ROOT = path.resolve(__dirname, '..');

function seedPlan(dir) {
  fs.mkdirSync(path.join(dir, 'specs/stories'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs/reviews'), { recursive: true });
  const schemaRel = '.claude/skills/evaluate/references/contract-schema.json';
  fs.mkdirSync(path.dirname(path.join(dir, schemaRel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, schemaRel), path.join(dir, schemaRel));
  fs.writeFileSync(path.join(dir, 'specs/stories/story-traces.json'), `${JSON.stringify([
    { id: 'E1-S1', text: 'boot', traces: ['FRD-1'], acs: ['E1-S1-AC1'] },
    { id: 'E2-S1', text: 'ui', traces: ['FRD-2'], acs: ['E2-S1-AC1'] },
  ], null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'specs/stories/stories.json'), `${JSON.stringify([
    { id: 'E1-S1', title: 'Boot', layer: 'API', group: 'A' },
    { id: 'E2-S1', title: 'Page', layer: 'UI', group: 'B' },
  ], null, 2)}\n`);
  writePlan(dir);
}

function approveTest(dir) {
  fs.writeFileSync(path.join(dir, 'specs/reviews/test-approval.json'), `${JSON.stringify({
    phase: 'test', status: 'approved', artifacts: [], rounds: [],
  }, null, 2)}\n`);
}

function fillObserve(dir) {
  const planPath = path.join(dir, 'specs/test_artefacts/test-plan.md');
  let md = fs.readFileSync(planPath, 'utf8');
  md = md.replace('| A | QA-VM-001 | api | VM-001 | (fill) |', '| A | QA-VM-001 | api | VM-001 | GET /health → 200 |');
  md = md.replace('| B | QA-VM-002 | playwright | VM-002 | (fill) |', '| B | QA-VM-002 | playwright | VM-002 | homepage heading visible |');
  fs.writeFileSync(planPath, md);
}

test('parseApiObserve requires METHOD /path', () => {
  assert.ok(parseApiObserve('(fill)').error);
  assert.deepStrictEqual(parseApiObserve('GET /health → 200'), {
    method: 'GET', path: '/health', expected_status: 200,
  });
  assert.strictEqual(parsePwObserve('click Submit').description, 'click Submit');
});

test('freeze refuses unfilled Observe and missing test approval', () => {
  const dir = tmp();
  seedPlan(dir);
  const noApproval = freeze(dir);
  assert.strictEqual(noApproval.ok, false);
  approveTest(dir);
  const unfilled = freeze(dir);
  assert.strictEqual(unfilled.ok, false);
  assert.match(unfilled.error, /unfilled/i);
});

test('freeze writes nested contracts and --check catches a rewrite', () => {
  const dir = tmp();
  seedPlan(dir);
  approveTest(dir);
  fillObserve(dir);
  const result = freeze(dir);
  assert.strictEqual(result.ok, true, result.error);
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'sprint-contracts/A.json'), 'utf8'));
  assert.strictEqual(a.group, 'A');
  assert.strictEqual(a.contract.api_checks[0].method, 'GET');
  assert.strictEqual(a.contract.api_checks[0].path, '/health');
  assert.deepStrictEqual(a.contract.api_checks[0].matrix_ids, ['VM-001']);
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'sprint-contracts/B.json'), 'utf8'));
  assert.ok(b.contract.playwright_checks[0].steps.length);
  assert.ok(b.contract.accessibility_checks);
  assert.strictEqual(verifyFreeze(dir).ok, true);
  a.contract.api_checks[0].expected_status = 500;
  fs.writeFileSync(path.join(dir, 'sprint-contracts/A.json'), `${JSON.stringify(a, null, 2)}\n`);
  const check = verifyFreeze(dir);
  assert.strictEqual(check.ok, false);
  assert.match(check.error, /hash changed/);
  const chunks = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { chunks.push(s); return true; };
  let code;
  try { code = run(['--check', '--root', dir], dir); } finally { process.stderr.write = write; }
  assert.strictEqual(code, 1);
});
