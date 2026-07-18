'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { run } = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'record-reuse-decision.js'));

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-')); }
const OUT = path.join('specs', 'reviews', 'reuse-decisions.jsonl');

test('appends a well-formed decision record and returns 0', () => {
  const root = tmpRoot();
  const code = run(
    ['--story', 'E1-S2', '--decision', 'extend', '--seam', 'src/services/upload_service.py',
     '--action', 'extend', '--justification', 'reuse the upload pipeline node',
     '--invariant-impact', 'I-3 upload-goes-through-pipeline', '--budget', '{"latency_ms_p95":800}',
     '--options', 'considered new module; rejected as clone'],
    root, { now: () => '2026-07-18T00:00:00.000Z' });
  assert.strictEqual(code, 0);
  const lines = fs.readFileSync(path.join(root, OUT), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.strictEqual(rec.storyId, 'E1-S2');
  assert.strictEqual(rec.decision, 'extend');
  assert.strictEqual(rec.seam, 'src/services/upload_service.py');
  assert.strictEqual(rec.action, 'extend');
  assert.strictEqual(rec.justification, 'reuse the upload pipeline node');
  assert.strictEqual(rec.invariant_impact, 'I-3 upload-goes-through-pipeline');
  assert.deepStrictEqual(rec.budget, { latency_ms_p95: 800 });
  assert.strictEqual(rec.recordedAt, '2026-07-18T00:00:00.000Z');
});

test('is append-only (second call adds a second line)', () => {
  const root = tmpRoot();
  const args = ['--story', 'S1', '--decision', 'net-new', '--justification', 'genuinely new capability'];
  run(args, root, { now: () => 't1' });
  run(['--story', 'S2', '--decision', 'net-new', '--justification', 'also new'], root, { now: () => 't2' });
  assert.strictEqual(fs.readFileSync(path.join(root, OUT), 'utf8').trim().split('\n').length, 2);
});

test('missing required args → usage, exit 2, nothing written', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['--story', 'S1'], root, {}), 2); // no --decision/--justification
  assert.ok(!fs.existsSync(path.join(root, OUT)));
});

test('extend/new-seam without --seam → exit 2', () => {
  assert.strictEqual(run(['--story', 'S1', '--decision', 'extend', '--justification', 'x'], tmpRoot(), {}), 2);
});

test('malformed --budget JSON is stored as null, not thrown', () => {
  const root = tmpRoot();
  const code = run(['--story', 'S1', '--decision', 'net-new', '--justification', 'x', '--budget', 'not json'], root, { now: () => 't' });
  assert.strictEqual(code, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, OUT), 'utf8').trim()).budget, null);
});
