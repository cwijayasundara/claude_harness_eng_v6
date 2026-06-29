'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, '.claude', 'scripts', 'approved-fixtures-gate.js');
const APPROVE = path.join(ROOT, '.claude', 'scripts', 'approve-fixtures.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'af2-')); }
function gateCode(dir) {
  try { execFileSync('node', [GATE, '--root', dir], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; }
}

test('round-trip: gate blocks an unapproved snapshot, approve --all unblocks it', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'HELLO');
  assert.strictEqual(gateCode(dir), 1); // unapproved -> blocked
  execFileSync('node', [APPROVE, '--root', dir, '--all', '--approver', 'tester', '--date', '2026-06-29'], { stdio: 'pipe' });
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'test_artefacts', 'approved-snapshots.json'), 'utf8'));
  assert.strictEqual(base.length, 1);
  assert.strictEqual(base[0].path, 'a.snap');
  assert.ok(base[0].checksum.startsWith('sha256:'));
  assert.strictEqual(base[0].approved_by, 'tester');
  assert.strictEqual(gateCode(dir), 0); // now approved -> pass
});

test('approve --snapshots upserts only the named file, preserving others', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'A');
  fs.writeFileSync(path.join(dir, 'b.snap'), 'B');
  const p = path.join(dir, 'specs', 'test_artefacts', 'approved-snapshots.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify([{ path: 'a.snap', checksum: 'sha256:STALE', approved_by: 'old', date: '2026-01-01' }]));
  execFileSync('node', [APPROVE, '--root', dir, '--snapshots', 'b.snap', '--date', '2026-06-29'], { stdio: 'pipe' });
  const base = JSON.parse(fs.readFileSync(p, 'utf8'));
  const byPath = Object.fromEntries(base.map((e) => [e.path, e]));
  assert.ok(byPath['b.snap'], 'b.snap added');
  assert.strictEqual(byPath['a.snap'].checksum, 'sha256:STALE', 'a.snap entry preserved untouched');
});
