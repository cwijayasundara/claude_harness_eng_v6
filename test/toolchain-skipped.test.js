const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { skipped, shouldBlock } = require(path.join(
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
