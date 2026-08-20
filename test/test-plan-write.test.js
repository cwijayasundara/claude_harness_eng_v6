'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePlan, buildPlan, layerFor, parseGwt, gwtFromAc, evaluatorKind, run } = require('../.claude/scripts/test-plan-write');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'test-plan-write-'));
}

function seed(dir) {
  fs.mkdirSync(path.join(dir, 'specs/stories'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/stories/story-traces.json'), `${JSON.stringify([
    { id: 'E1-S1', text: 'boot', traces: ['FRD-1'], acs: ['E1-S1-AC1', 'E1-S1-AC2'] },
    { id: 'E2-S1', text: 'ui', traces: ['FRD-2'], acs: ['E2-S1-AC1'] },
  ], null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'specs/stories/stories.json'), `${JSON.stringify([
    { id: 'E1-S1', title: 'Boot', layer: 'API', group: 'A' },
    { id: 'E2-S1', title: 'Page', layer: 'UI', group: 'B' },
  ], null, 2)}\n`);
}

test('parseGwt splits Given/When/Then without Cucumber', () => {
  assert.deepStrictEqual(
    parseGwt('Given a live API, when GET /health, then status is 200'),
    { given: 'a live API', when: 'GET /health', then: 'status is 200' },
  );
  assert.deepStrictEqual(parseGwt('status is 200'), { given: '', when: '', then: 'status is 200' });
  assert.deepStrictEqual(
    gwtFromAc({ given: 'a member', when: 'they submit', then: '201' }),
    { given: 'a member', when: 'they submit', then: '201' },
  );
});

test('evaluatorKind maps matrix layers to api or playwright checks', () => {
  assert.strictEqual(evaluatorKind(['api']), 'api');
  assert.strictEqual(evaluatorKind(['e2e']), 'playwright');
  assert.strictEqual(evaluatorKind(['api', 'e2e']), 'playwright');
  assert.strictEqual(evaluatorKind(['unit']), null);
});

test('layerFor maps story layer to a matrix layer', () => {
  assert.strictEqual(layerFor({ layer: 'UI' }), 'e2e');
  assert.strictEqual(layerFor({ layer: 'frontend' }), 'e2e');
  assert.strictEqual(layerFor({ layer: 'Config' }), 'unit');
  assert.strictEqual(layerFor({ layer: 'API' }), 'api');
});

test('buildPlan emits one row per AC with a planned check', () => {
  const dir = tmp();
  seed(dir);
  const traces = JSON.parse(fs.readFileSync(path.join(dir, 'specs/stories/story-traces.json'), 'utf8'));
  const stories = JSON.parse(fs.readFileSync(path.join(dir, 'specs/stories/stories.json'), 'utf8'));
  const { requirements, testTraces } = buildPlan({ traces, stories, acceptance: [] });
  assert.strictEqual(requirements.length, 3);
  assert.strictEqual(requirements[0].id, 'VM-001');
  assert.strictEqual(requirements[0].ac_id, 'E1-S1-AC1');
  assert.deepStrictEqual(requirements[0].required_layers, ['api']);
  assert.strictEqual(requirements[0].checks[0].layer, 'api');
  assert.strictEqual(requirements[2].required_layers[0], 'e2e');
  assert.deepStrictEqual(testTraces[0].traces, ['E1-S1-AC1', 'FRD-1']);
});

test('writePlan refuses to run without story-traces', () => {
  const dir = tmp();
  const result = writePlan(dir);
  assert.strictEqual(result.ok, false);
});

test('writePlan writes matrix + traces + skeleton and is idempotent', () => {
  const dir = tmp();
  seed(dir);
  const first = writePlan(dir);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.skipped, false);
  assert.strictEqual(first.rows, 3);
  const matrix = JSON.parse(fs.readFileSync(path.join(dir, 'specs/test_artefacts/verification-matrix.json'), 'utf8'));
  assert.strictEqual(matrix.requirements.length, 3);
  const planMd = fs.readFileSync(path.join(dir, 'specs/test_artefacts/test-plan.md'), 'utf8');
  assert.match(planMd, /Named Seams/);
  assert.match(planMd, /Behavior scenarios \(Given \/ When \/ Then\)/);
  assert.match(planMd, /Proposed sprint-contract checks/);
  assert.match(planMd, /QA-VM-001/);
  assert.match(planMd, /\| api \|/);
  assert.match(planMd, /\| playwright \|/);
  assert.match(planMd, /Do not write `sprint-contracts\/\*\.json`/);
  const second = writePlan(dir);
  assert.strictEqual(second.skipped, true);
  const forced = writePlan(dir, { force: true });
  assert.strictEqual(forced.skipped, false);
});

test('writePlan attaches schema obligations and design-trace paths', () => {
  const dir = tmp();
  seed(dir);
  fs.mkdirSync(path.join(dir, 'specs/design'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/design/design-traces.json'), `${JSON.stringify([
    { id: 'backend/src/boot.py', traces: ['E1-S1'] },
  ])}\n`);
  fs.writeFileSync(path.join(dir, 'specs/design/data-models.schema.json'), `${JSON.stringify({
    $defs: { HealthResponse: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } },
  })}\n`);
  fs.writeFileSync(path.join(dir, 'specs/stories/acceptance-criteria.json'), `${JSON.stringify([
    { id: 'E1-S1-AC1', then: 'health status is ok' },
  ])}\n`);
  const first = writePlan(dir);
  assert.strictEqual(first.ok, true);
  assert.ok(first.obligations >= 1);
  const matrix = JSON.parse(fs.readFileSync(path.join(dir, 'specs/test_artefacts/verification-matrix.json'), 'utf8'));
  assert.ok(matrix.requirements[0].implementation_paths.includes('backend/src/boot.py'));
  const traces = JSON.parse(fs.readFileSync(path.join(dir, 'specs/test_artefacts/test-traces.json'), 'utf8'));
  assert.ok(traces.some((t) => t.traces.some((id) => String(id).startsWith('OBL-'))));
});

test('skeleton GWT uses acceptance-criteria Given/When/Then text', () => {
  const dir = tmp();
  seed(dir);
  fs.writeFileSync(path.join(dir, 'specs/stories/acceptance-criteria.json'), `${JSON.stringify([
    { id: 'E1-S1-AC1', given: 'a live API', when: 'GET /health', then: 'status is 200' },
    { id: 'E1-S1-AC2', text: 'Given a live API, when GET /ready, then status is 200' },
  ], null, 2)}\n`);
  writePlan(dir);
  const planMd = fs.readFileSync(path.join(dir, 'specs/test_artefacts/test-plan.md'), 'utf8');
  assert.match(planMd, /E1-S1-AC1/);
  assert.match(planMd, /a live API/);
  assert.match(planMd, /GET \/health/);
  assert.match(planMd, /status is 200/);
  assert.match(planMd, /GET \/ready/);
  assert.match(planMd, /QA-VM-001[\s\S]*\| \(fill\) \|/);
  assert.match(planMd, /Do not write `\.feature`/);
});

test('unit-only stories have no evaluator check row', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'specs/stories'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/stories/story-traces.json'), `${JSON.stringify([
    { id: 'E1-S1', text: 'hash', traces: ['FRD-1'], acs: ['E1-S1-AC1'] },
  ], null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'specs/stories/stories.json'), `${JSON.stringify([
    { id: 'E1-S1', title: 'Hash', layer: 'Config', group: 'A' },
  ], null, 2)}\n`);
  writePlan(dir);
  const planMd = fs.readFileSync(path.join(dir, 'specs/test_artefacts/test-plan.md'), 'utf8');
  assert.match(planMd, /none — unit\/seam only/);
  assert.doesNotMatch(planMd, /QA-VM-001/);
});

test('--force rebuilds the matrix but keeps a filled test-plan.md and reviewed layers', () => {
  const dir = tmp();
  seed(dir);
  writePlan(dir);
  const planPath = path.join(dir, 'specs/test_artefacts/test-plan.md');
  fs.writeFileSync(planPath, '# Test Plan\n\n## Named Seams\n\nReviewed seams stay.\n');
  const matrixPath = path.join(dir, 'specs/test_artefacts/verification-matrix.json');
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  matrix.requirements[0].required_layers = ['api', 'security'];
  matrix.requirements[0].checks = [{ id: 'CHK-VM-001-security', layer: 'security', description: 'isolation' }];
  matrix.requirements[0].obligations = ['OBL-reviewed'];
  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  const forced = writePlan(dir, { force: true });
  assert.strictEqual(forced.skipped, false);
  assert.match(fs.readFileSync(planPath, 'utf8'), /Reviewed seams stay/);
  const rebuilt = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  assert.deepStrictEqual(rebuilt.requirements[0].required_layers, ['api', 'security']);
  assert.ok(rebuilt.requirements[0].obligations.includes('OBL-reviewed'));
  const reset = writePlan(dir, { force: true, resetPlan: true });
  assert.strictEqual(reset.skipped, false);
  assert.match(fs.readFileSync(planPath, 'utf8'), /Named Seams \(Ports-and-Adapters\)/);
  assert.doesNotMatch(fs.readFileSync(planPath, 'utf8'), /Reviewed seams stay/);
});

test('CLI prints counts and does not dump the matrix', () => {
  const dir = tmp();
  seed(dir);
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  let code;
  try { code = run(['--root', dir], dir); } finally { process.stdout.write = write; }
  assert.strictEqual(code, 0);
  const out = chunks.join('');
  assert.match(out, /3 matrix rows over 2 stories/);
  assert.doesNotMatch(out, /E1-S1-AC1/);
});
