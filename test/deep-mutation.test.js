'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude/scripts/deep-mutation.js');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-mutation-'));
  fs.mkdirSync(path.join(root, 'specs/reviews'), { recursive: true });
  return root;
}

function run(root, args = []) {
  return cp.spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
}

test('unprovisioned project exits 0 with an unprovisioned verdict', () => {
  const root = tmpProject();
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/deep-mutation-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'unprovisioned');
});

test('JS project prefers Stryker when configured', () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, 'stryker.conf.js'), 'module.exports = {};');
  const r = run(root, ['--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/deep-mutation-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.tool, 'stryker');
  assert.match(verdict.command, /stryker run/);
});

test('Python project prefers mutmut when configured', () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, 'setup.cfg'), '[mutmut]\npaths_to_mutate=src\n');
  const r = run(root, ['--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/deep-mutation-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.tool, 'mutmut');
  assert.match(verdict.command, /mutmut run/);
});

test('--critical-only adds configured critical globs to the command', () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, 'stryker.conf.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    quality: { mutation: { critical_globs: ['src/billing/**/*.ts', 'src/auth/**/*.ts'] } },
  }));
  const r = run(root, ['--dry-run', '--critical-only']);
  assert.strictEqual(r.status, 0, r.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/deep-mutation-verdict.json'), 'utf8'));
  assert.match(verdict.command, /src\/billing/);
  assert.match(verdict.command, /src\/auth/);
});
