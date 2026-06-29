'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'contract-drift-gate.js');
const { verdictFromExit } = require('../.claude/scripts/contract-drift-gate.js');

// Top-level helper so the brace-depth gate sees a properly bounded function.
function gitIn(dir, args) {
  return execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

// A temp git repo with `openapi.yaml` committed at HEAD, then modified in the
// working tree, so `git show HEAD:openapi.yaml` (base) differs from the file.
function repoWithSpec() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-'));
  gitIn(dir, ['init', '-q']); gitIn(dir, ['config', 'user.email', 't@t']); gitIn(dir, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}\n');
  gitIn(dir, ['add', '.']); gitIn(dir, ['commit', '-qm', 'base']);
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), 'openapi: 3.0.0\npaths:\n  /x: {}\n'); // working change
  return dir;
}

function runGate(dir, extra) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir, ...extra], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'contract-drift-verdict.json'), 'utf8'));
  return { code, v };
}

// A fake oasdiff: an executable script that exits with a fixed code.
function fakeOasdiff(dir, exitCode) {
  const p = path.join(dir, 'fake-oasdiff.sh');
  fs.writeFileSync(p, `#!/bin/sh\nexit ${exitCode}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

test('verdictFromExit: 0 -> pass, non-zero -> breaking', () => {
  assert.strictEqual(verdictFromExit(0), 'pass');
  assert.strictEqual(verdictFromExit(1), 'breaking');
});

test('no OpenAPI spec -> exit 0, verdict no-spec', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-'));
  const { code, v } = runGate(dir, []);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'no-spec');
});

test('oasdiff missing -> exit 0, verdict unprovisioned', () => {
  const dir = repoWithSpec();
  const { code, v } = runGate(dir, ['--oasdiff', '/no/such/oasdiff-bin']);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'unprovisioned');
  assert.ok(/oasdiff/i.test(v.message));
});

test('breaking changes (fake oasdiff exit 1) -> exit 1, verdict breaking', () => {
  const dir = repoWithSpec();
  const { code, v } = runGate(dir, ['--oasdiff', fakeOasdiff(dir, 1)]);
  assert.strictEqual(code, 1);
  assert.strictEqual(v.verdict, 'breaking');
});

test('no breaking (fake oasdiff exit 0) -> exit 0, verdict pass', () => {
  const dir = repoWithSpec();
  const { code, v } = runGate(dir, ['--oasdiff', fakeOasdiff(dir, 0)]);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'pass');
});
