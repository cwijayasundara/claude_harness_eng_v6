'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'record-at-red.js');
const { run, resolveOutPath, appendReceipt, runTestCmd } = require(SCRIPT);

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'record-at-red-'));
}

function throwingExec() {
  const err = new Error('exit 1');
  err.status = 1;
  throw err;
}

function passingExec() {
  return '';
}

test('runTestCmd returns true (red) when the command throws', () => {
  assert.strictEqual(runTestCmd('anything', '/tmp', throwingExec), true);
});

test('runTestCmd returns false (green) when the command succeeds', () => {
  assert.strictEqual(runTestCmd('anything', '/tmp', passingExec), false);
});

test('run records a receipt and exits 0 when the AT is red', () => {
  const dir = makeProject();
  const code = run(
    ['--story', 'E1-S1', '--at-file', 'specs/test_artefacts/acceptance/E1-S1.test.js', '--test-cmd', 'node fail.js'],
    dir,
    { exec: throwingExec, now: () => '2026-07-08T00:00:00.000Z' }
  );
  assert.strictEqual(code, 0);
  const receiptsPath = path.join(dir, 'specs', 'reviews', 'at-red-receipts.jsonl');
  const rows = fs.readFileSync(receiptsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], {
    storyId: 'E1-S1',
    atPath: 'specs/test_artefacts/acceptance/E1-S1.test.js',
    observedRedAt: '2026-07-08T00:00:00.000Z',
    testCmd: 'node fail.js',
  });
});

test('run does NOT record a receipt and exits non-zero when the AT is green', () => {
  const dir = makeProject();
  const code = run(
    ['--story', 'E1-S1', '--at-file', 'specs/test_artefacts/acceptance/E1-S1.test.js', '--test-cmd', 'node pass.js'],
    dir,
    { exec: passingExec }
  );
  assert.notStrictEqual(code, 0);
  const receiptsPath = path.join(dir, 'specs', 'reviews', 'at-red-receipts.jsonl');
  assert.strictEqual(fs.existsSync(receiptsPath), false);
});

test('run appends multiple receipts across separate invocations', () => {
  const dir = makeProject();
  run(['--story', 'E1-S1', '--at-file', 'a.js', '--test-cmd', 'x'], dir, { exec: throwingExec, now: () => 't1' });
  run(['--story', 'E1-S2', '--at-file', 'b.js', '--test-cmd', 'y'], dir, { exec: throwingExec, now: () => 't2' });
  const receiptsPath = path.join(dir, 'specs', 'reviews', 'at-red-receipts.jsonl');
  const rows = fs.readFileSync(receiptsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].storyId, 'E1-S1');
  assert.strictEqual(rows[1].storyId, 'E1-S2');
});

test('run exits 2 on missing required args', () => {
  const dir = makeProject();
  assert.strictEqual(run(['--story', 'E1-S1'], dir, {}), 2);
  assert.strictEqual(run([], dir, {}), 2);
});

test('resolveOutPath defaults to specs/reviews/at-red-receipts.jsonl under root', () => {
  const dir = '/some/root';
  assert.strictEqual(resolveOutPath(dir, []), path.join(dir, 'specs', 'reviews', 'at-red-receipts.jsonl'));
});

test('resolveOutPath honors an explicit --out', () => {
  const dir = '/some/root';
  assert.strictEqual(resolveOutPath(dir, ['--out', 'custom/path.jsonl']), path.join(dir, 'custom', 'path.jsonl'));
});

test('appendReceipt creates parent directories and appends JSON lines', () => {
  const dir = makeProject();
  const out = path.join(dir, 'nested', 'receipts.jsonl');
  appendReceipt(out, { a: 1 });
  appendReceipt(out, { a: 2 });
  const rows = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(rows, [{ a: 1 }, { a: 2 }]);
});
