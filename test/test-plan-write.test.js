'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePlan, buildPlan, layerFor, run } = require('../.claude/scripts/test-plan-write');

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

test('layerFor maps story layer to a matrix layer', () => {
  assert.strictEqual(layerFor({ layer: 'UI' }), 'e2e');
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
  assert.match(fs.readFileSync(path.join(dir, 'specs/test_artefacts/test-plan.md'), 'utf8'), /Named Seams/);
  const second = writePlan(dir);
  assert.strictEqual(second.skipped, true);
  const forced = writePlan(dir, { force: true });
  assert.strictEqual(forced.skipped, false);
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
