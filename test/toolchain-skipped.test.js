const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { skipped, shouldBlock, localBinArgv, runLocalFirst } = require(path.join(
  __dirname, '..', '.claude', 'hooks', 'lib', 'toolchain.js'
));

test('a clean pass (status 0) is neither skipped nor blocked', () => {
  const res = { status: 0, stdout: 'All good', stderr: '' };
  assert.strictEqual(skipped(res), false);
  assert.strictEqual(shouldBlock(res), false);
});

test('a genuine failure blocks and is not skipped', () => {
  const res = { status: 1, stdout: 'error: 3 problems', stderr: '' };
  assert.strictEqual(skipped(res), false);
  assert.strictEqual(shouldBlock(res), true);
});

test('spawn failure, kill, and not-found are skipped (failed open)', () => {
  assert.strictEqual(skipped({ error: new Error('ENOENT') }), true);
  assert.strictEqual(skipped({ status: null, stdout: '', stderr: '' }), true);
  assert.strictEqual(skipped({ status: 127, stdout: '', stderr: '' }), true);
  assert.strictEqual(skipped(null), true);
});

test('an unprovisioned toolchain (non-zero + missing signature) is skipped, not blocked', () => {
  const res = { status: 1, stdout: '', stderr: 'command not found: ruff' };
  assert.strictEqual(skipped(res), true);
  assert.strictEqual(shouldBlock(res), false);
});

test('localBinArgv returns the project-local binary argv when it exists, else null', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-local-'));
  const binDir = path.join(dir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const eslint = path.join(binDir, 'eslint');
  fs.writeFileSync(eslint, '#!/bin/sh\n');
  assert.deepStrictEqual(
    localBinArgv(dir, path.join('node_modules', '.bin'), 'eslint', ['x.js']),
    [eslint, 'x.js']
  );
  assert.strictEqual(
    localBinArgv(dir, path.join('node_modules', '.bin'), 'missing', ['x.js']),
    null
  );
});

test('runLocalFirst runs the fallback argv when no local binary is resolved', () => {
  const res = runLocalFirst(null, ['node', '-e', 'process.exit(0)'], process.cwd(), 5000);
  assert.strictEqual(res.status, 0);
});

test('runLocalFirst prefers the direct argv when one is given', () => {
  const res = runLocalFirst(['node', '-e', 'process.exit(3)'], ['node', '-e', 'process.exit(0)'], process.cwd(), 5000);
  assert.strictEqual(res.status, 3, 'direct argv should win over fallback');
});

test('runLocalFirst falls back to the wrapper when a present-but-broken local binary fails to spawn', () => {
  // Simulates a relocated venv: the local binary path is chosen but execve fails
  // (ENOENT). Must retry the self-healing wrapper, not silently skip the check.
  const badDirect = ['/nonexistent/.venv/bin/ruff', 'check', 'x.py'];
  const res = runLocalFirst(badDirect, ['node', '-e', 'process.exit(0)'], process.cwd(), 5000);
  assert.strictEqual(res.status, 0, 'should fall back to the wrapper on a spawn error');
});

test('skipped and shouldBlock are mutually exclusive across outcomes', () => {
  const cases = [
    { status: 0, stdout: '', stderr: '' },
    { status: 1, stdout: 'real failure', stderr: '' },
    { status: 1, stdout: '', stderr: 'no such file or directory' },
    { status: null, stdout: '', stderr: '' },
  ];
  for (const res of cases) {
    assert.ok(!(skipped(res) && shouldBlock(res)), JSON.stringify(res));
  }
});
