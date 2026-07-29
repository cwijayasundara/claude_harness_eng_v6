'use strict';

// Gap G41, ledger half. The red-phase record is what arms the G42 test-write-lock
// and supplies the red SHA the G43 commit proof diffs against, so the ledger is
// itself an integrity surface: an agent that can silently rewrite "this test
// failed first" can unlock any test. Hash-chained per event, reusing
// task-lifecycle.js's eventHash rather than a second implementation.
//
// The arming rule under test — settled by reading skills/pinning-down-behavior:
//
//   A test file whose FIRST observed run (within a task) is RED arms the lock.
//   Green-first NEVER arms.
//
// That is not an exemption bolted on for the legacy lanes; it is the semantic
// difference between the two disciplines. TDD is red-first by definition.
// Characterization (pin-down) tests are green-first by definition — Step 3 of
// that skill says "Run green against the current code" — and Step 3 also
// explicitly permits repairing a pin later ("adding a matcher later for a
// nondeterministic field is harness repair, allowed"). A lock that armed on any
// red run would forbid that permitted repair, because Step 4 deliberately makes
// the pins fail.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LEDGER_REL,
  appendRun,
  readLedger,
  fileState,
} = require('../.claude/hooks/lib/red-phase-ledger');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'red-phase-'));
}

function run(root, over = {}) {
  const merged = {
    task_id: 'T-1',
    runner: 'pytest',
    verdict: 'fail',
    test_files: ['tests/test_a.py'],
    head_sha: 'abc1234',
    command: 'pytest tests/test_a.py',
    ...over,
  };
  // Content hashes are required — the G43 proof compares the test text at the red
  // run against the text at the green run. Default to a stable per-file hash so
  // cases that do not care about content stay readable.
  if (!merged.file_hashes) {
    merged.file_hashes = Object.fromEntries(merged.test_files.map((f) => [f, `hash-of-${f}`]));
  }
  return appendRun(root, merged, new Date('2026-07-29T10:00:00Z'));
}

test('readLedger reports absent before anything is recorded', () => {
  const root = tmpRoot();
  const led = readLedger(root);
  assert.strictEqual(led.state, 'absent');
  assert.deepStrictEqual(led.events, []);
});

test('appendRun writes a hash-chained event and readLedger validates it', () => {
  const root = tmpRoot();
  const first = run(root);
  const second = run(root, { verdict: 'pass' });
  assert.strictEqual(first.sequence, 1);
  assert.strictEqual(first.previous_event_hash, null);
  assert.strictEqual(second.sequence, 2);
  assert.strictEqual(second.previous_event_hash, first.event_hash);

  const led = readLedger(root);
  assert.strictEqual(led.state, 'valid');
  assert.strictEqual(led.events.length, 2);
  assert.strictEqual(led.errors.length, 0);
});

test('readLedger detects a tampered event — the record cannot be edited silently', () => {
  const root = tmpRoot();
  run(root);
  run(root, { verdict: 'pass' });
  const file = path.join(root, LEDGER_REL);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const forged = JSON.parse(lines[0]);
  forged.verdict = 'pass'; // "it was never red" — the exact tamper that unlocks
  lines[0] = JSON.stringify(forged);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  const led = readLedger(root);
  assert.strictEqual(led.state, 'invalid');
  assert.ok(led.errors.some((e) => /hash mismatch/.test(e)), led.errors.join('; '));
});

test('appendRun refuses to record an env-broken run — it is not evidence of anything', () => {
  const root = tmpRoot();
  assert.throws(() => run(root, { verdict: 'env-broken' }), /env-broken/);
  assert.strictEqual(readLedger(root).state, 'absent');
});

test('appendRun refuses a run that names no test files', () => {
  const root = tmpRoot();
  assert.throws(() => run(root, { test_files: [] }), /test_files/);
});

// Without a content hash the ledger records only that a run happened, which says
// nothing about WHICH test text was running — and the G43 red-vs-green
// comparison silently degrades to a no-op.
test('appendRun refuses a run missing a content hash for any named test file', () => {
  const root = tmpRoot();
  assert.throws(() => run(root, { file_hashes: {} }), /content hash/);
  assert.throws(
    () => run(root, { test_files: ['tests/test_a.py', 'tests/test_b.py'], file_hashes: { 'tests/test_a.py': 'H1' } }),
    /content hash/
  );
  assert.strictEqual(readLedger(root).state, 'absent');
});

// ------------------------------------------------------------------- fileState

test('fileState reports red-first for a TDD test', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  run(root, { verdict: 'pass' });
  const st = fileState(readLedger(root).events, 'T-1', 'tests/test_a.py');
  assert.strictEqual(st.firstVerdict, 'fail');
  assert.strictEqual(st.redFirst, true);
  assert.strictEqual(st.redSha, 'red111');
});

test('fileState reports green-first for a pin-down test, even after a later red run', () => {
  const root = tmpRoot();
  // Step 3: pins run green against unmodified code.
  run(root, { verdict: 'pass', test_files: ['tests/test_pin.py'] });
  // Step 4: deliberately flip production code, watch the pins fail, then revert.
  run(root, { verdict: 'fail', test_files: ['tests/test_pin.py'], head_sha: 'flip999' });
  const st = fileState(readLedger(root).events, 'T-1', 'tests/test_pin.py');
  assert.strictEqual(st.firstVerdict, 'pass');
  assert.strictEqual(st.redFirst, false, 'the mutation-smoke checkpoint must not arm the lock');
});

test('fileState is scoped per task — a new task resets first-run state', () => {
  const root = tmpRoot();
  run(root, { task_id: 'T-1', verdict: 'pass' });
  run(root, { task_id: 'T-2', verdict: 'fail', head_sha: 'red222' });
  assert.strictEqual(fileState(readLedger(root).events, 'T-1', 'tests/test_a.py').redFirst, false);
  const t2 = fileState(readLedger(root).events, 'T-2', 'tests/test_a.py');
  assert.strictEqual(t2.redFirst, true);
  assert.strictEqual(t2.redSha, 'red222');
});

test('fileState returns null for a file the ledger has never seen', () => {
  const root = tmpRoot();
  run(root);
  assert.strictEqual(fileState(readLedger(root).events, 'T-1', 'tests/test_unseen.py'), null);
});

// `open` is narrower than red-first on purpose. Locking a file for the whole
// task would break ordinary TDD: write test 1, go green, then add test 2 to the
// same file and you are blocked by your own passing work. The tamper worth
// blocking is the narrow one — the test is failing NOW and the agent edits the
// test rather than the production code.
test('fileState closes the cycle once a red-first file goes green', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  let st = fileState(readLedger(root).events, 'T-1', 'tests/test_a.py');
  assert.strictEqual(st.open, true, 'still failing — locked');

  run(root, { verdict: 'pass' });
  st = fileState(readLedger(root).events, 'T-1', 'tests/test_a.py');
  assert.strictEqual(st.redFirst, true, 'history is preserved for the G43 proof');
  assert.strictEqual(st.open, false, 'cycle closed — adding the next test must be allowed');
});

test('fileState re-arms when a new red run follows the green', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  run(root, { verdict: 'pass' });
  run(root, { verdict: 'fail', head_sha: 'red333' });
  const st = fileState(readLedger(root).events, 'T-1', 'tests/test_a.py');
  assert.strictEqual(st.open, true);
  assert.strictEqual(st.redSha, 'red333');
});

test('a green-first pin-down file is never open, even while its latest run is red', () => {
  const root = tmpRoot();
  run(root, { verdict: 'pass', test_files: ['tests/test_pin.py'] });
  run(root, { verdict: 'fail', test_files: ['tests/test_pin.py'], head_sha: 'flip999' });
  const st = fileState(readLedger(root).events, 'T-1', 'tests/test_pin.py');
  assert.strictEqual(st.latestVerdict, 'fail');
  assert.strictEqual(st.open, false, 'the mutation-smoke checkpoint must not lock the pin');
});

test('fileState tracks the LATEST red sha, so a new failing test re-anchors the proof', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  run(root, { verdict: 'pass' });
  run(root, { verdict: 'fail', head_sha: 'red333' });
  const st = fileState(readLedger(root).events, 'T-1', 'tests/test_a.py');
  assert.strictEqual(st.redSha, 'red333');
  assert.strictEqual(st.redFirst, true);
});
