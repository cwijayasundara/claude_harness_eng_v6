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

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G12: approved-fixtures is wired + registered active', () => {
  assert.ok(/approved-fixtures-gate\.js|approved-fixtures/.test(rd('.claude/skills/gate/SKILL.md')), '/gate must run the gate');
  assert.strictEqual(JSON.parse(rd('package.json')).scripts['approved-fixtures'], 'node .claude/scripts/approved-fixtures-gate.js');
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'approved-fixtures-gate');
  assert.ok(s, 'approved-fixtures-gate sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'repo');
  assert.ok(s.wired_at && fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
});

test('G12: gate is dormant on the harness repo (no snapshot files -> exit 0)', () => {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', ROOT, '--out', path.join(os.tmpdir(), `af-harness-${process.pid}.json`)], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  assert.strictEqual(code, 0); // the harness uses node:test assertions, not snapshot files
});

test('matcher: .approved.* (png/xml) covered + build/output dirs ignored (minors fix)', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ui.approved.png'), 'x');
  fs.writeFileSync(path.join(dir, 'ui.approved.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'real.snap'), 'x');
  for (const d of ['dist', 'coverage', '__pycache__']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'x.snap'), 'x');
  }
  const found = lib.findSnapshots(dir, lib.DEFAULT_PATTERNS);
  assert.ok(found.includes('ui.approved.png'), '.approved.png detected');
  assert.ok(found.includes('ui.approved.txt'), '.approved.txt detected');
  assert.ok(found.includes('real.snap'));
  assert.ok(!found.some((f) => /^(dist|coverage|__pycache__)\//.test(f)), 'build/output dirs ignored');
});
