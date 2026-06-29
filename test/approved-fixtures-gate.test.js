'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'approved-fixtures-gate.js');
const lib = require('../.claude/hooks/lib/fixtures.js');

test('classify buckets ok/modified/unapproved/removed', () => {
  const found = ['a.snap', 'b.snap', 'c.snap'];
  const baseline = [
    { path: 'a.snap', checksum: 'sha256:AA' },
    { path: 'b.snap', checksum: 'sha256:OLD' },
    { path: 'd.snap', checksum: 'sha256:DD' },
  ];
  const sums = { 'a.snap': 'sha256:AA', 'b.snap': 'sha256:NEW', 'c.snap': 'sha256:CC' };
  const r = lib.classify(found, baseline, (rel) => sums[rel]);
  assert.deepStrictEqual(r.ok, ['a.snap']);
  assert.deepStrictEqual(r.modified, ['b.snap']);
  assert.deepStrictEqual(r.unapproved, ['c.snap']);
  assert.deepStrictEqual(r.removed, ['d.snap']);
});

// CLI helpers
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'af-')); }
function runGate(dir) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'approved-fixtures-verdict.json'), 'utf8'));
  return { code, v };
}
function sha(dir, rel) { return lib.checksumOf(dir, rel); }
function baseline(dir, entries) {
  const p = path.join(dir, 'specs', 'test_artefacts', 'approved-snapshots.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2));
}

test('no snapshot files -> no-snapshots, exit 0 (dormant)', () => {
  const dir = tmp();
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'no-snapshots');
});

test('approved + matching baseline -> pass, exit 0', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, [{ path: 'a.snap', checksum: sha(dir, 'a.snap'), approved_by: 'h', date: '2026-06-29' }]);
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'pass');
});

test('modified approved snapshot -> blocked, exit 1', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, [{ path: 'a.snap', checksum: sha(dir, 'a.snap') }]);
  fs.writeFileSync(path.join(dir, 'a.snap'), 'CHANGED');
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 1);
  assert.strictEqual(v.verdict, 'blocked');
  assert.ok(v.modified.includes('a.snap'));
});

test('new unapproved snapshot -> blocked, exit 1', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, []); // empty baseline
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 1);
  assert.ok(v.unapproved.includes('a.snap'));
});

test('removed approved snapshot -> WARN, exit 0', () => {
  const dir = tmp();
  baseline(dir, [{ path: 'gone.snap', checksum: 'sha256:ZZ' }]);
  // a snapshot must exist or the gate short-circuits to no-snapshots; add an approved one
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, [
    { path: 'a.snap', checksum: sha(dir, 'a.snap') },
    { path: 'gone.snap', checksum: 'sha256:ZZ' },
  ]);
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'pass');
  assert.ok(v.removed.includes('gone.snap'));
});
