'use strict';

// Gap G41, ledger half. The red-phase record is what arms the G42 test-write-lock
// and supplies the red SHA the G43 commit proof diffs against, so the ledger is
// itself an integrity surface: an agent that can silently rewrite "this test
// failed first" can unlock any test. Hash-chained per event, reusing
// task-lifecycle.js's eventHash rather than a second implementation.
//
// The arming rule under test — settled by reading skills/pinning-down-behavior:
//
//   A test file whose FIRST observed run AT ITS CURRENT TEXT is RED arms the
//   lock. Green-first NEVER arms.
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
  openRedFiles,
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
//
// fileState is keyed on (file, CONTENT HASH) and NOT on task_id. Both of those
// are regression surfaces found by independent review of the first version:
//   - keying on task_id made it a self-service unlock (declare another task, or
//     none, and the ledger looked empty);
//   - keying on the path alone let the agent choose the ordering (run the file
//     once before adding the failing test → green-first forever).

const FILE = 'tests/test_a.py';
const H = `hash-of-${FILE}`; // what the run() helper records by default

function hashes(file, hash) {
  return { [file]: hash };
}

test('fileState reports red-first for a TDD test', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  run(root, { verdict: 'pass' });
  const st = fileState(readLedger(root).events, FILE, H);
  assert.strictEqual(st.firstVerdict, 'fail');
  assert.strictEqual(st.redFirst, true);
  assert.strictEqual(st.redSha, 'red111');
});

test('fileState reports green-first for a pin-down at the SAME text', () => {
  const root = tmpRoot();
  const pin = 'tests/test_pin.py';
  const ph = `hash-of-${pin}`;
  // Step 3: the pin runs green against unmodified code.
  run(root, { verdict: 'pass', test_files: [pin] });
  // Step 4: flip PRODUCTION code and watch the pin fail — the pin text is
  // unchanged, so this is the same content key.
  run(root, { verdict: 'fail', test_files: [pin], head_sha: 'flip999' });
  const st = fileState(readLedger(root).events, pin, ph);
  assert.strictEqual(st.firstVerdict, 'pass');
  assert.strictEqual(st.redFirst, false, 'the mutation-smoke checkpoint must not arm the lock');
  assert.strictEqual(st.open, false);
});

// C1 regression: task_id was a self-service unlock key.
test('fileState is task-agnostic — a different task cannot release the lock', () => {
  const root = tmpRoot();
  run(root, { task_id: 'T-1', verdict: 'fail', head_sha: 'red111' });
  // The agent declares a different task, or none at all.
  for (const events of [readLedger(root).events]) {
    const st = fileState(events, FILE, H);
    assert.strictEqual(st.open, true, 'the lock must not depend on the declared task');
  }
});

// I3 regression: green-first was order-gameable when keyed on the path alone.
test('a green run at OTHER text does not grant green-first to new text', () => {
  const root = tmpRoot();
  // The pre-existing suite runs green at text T0.
  run(root, { verdict: 'pass', file_hashes: hashes(FILE, 'T0') });
  // A failing test is then added: the file is now text T1.
  run(root, { verdict: 'fail', file_hashes: hashes(FILE, 'T1'), head_sha: 'red222' });

  const events = readLedger(root).events;
  assert.strictEqual(fileState(events, FILE, 'T0').redFirst, false, 'T0 was genuinely green-first');
  const t1 = fileState(events, FILE, 'T1');
  assert.strictEqual(t1.redFirst, true, 'T1 is red-first and MUST arm');
  assert.strictEqual(t1.open, true);
});

test('fileState returns null for content the ledger has never observed', () => {
  const root = tmpRoot();
  run(root);
  assert.strictEqual(fileState(readLedger(root).events, FILE, 'never-seen-hash'), null);
  assert.strictEqual(fileState(readLedger(root).events, 'tests/test_unseen.py', H), null);
});

// `open` is narrower than red-first on purpose: locking for a whole task would
// block adding test 2 to a file whose test 1 already passes.
test('fileState closes the cycle once a red-first file goes green', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  assert.strictEqual(fileState(readLedger(root).events, FILE, H).open, true, 'still failing — locked');

  run(root, { verdict: 'pass' });
  const st = fileState(readLedger(root).events, FILE, H);
  assert.strictEqual(st.redFirst, true, 'history preserved for the G43 proof');
  assert.strictEqual(st.open, false, 'cycle closed — adding the next test must be allowed');
});

test('fileState re-arms when a new red run follows the green', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', head_sha: 'red111' });
  run(root, { verdict: 'pass' });
  run(root, { verdict: 'fail', head_sha: 'red333' });
  const st = fileState(readLedger(root).events, FILE, H);
  assert.strictEqual(st.open, true);
  assert.strictEqual(st.redSha, 'red333');
});

// ---------------------------------------------------------------- openRedFiles

// B2: an unfiltered whole-suite green run names no files (bare `pytest` prints
// FAILED lines but nothing on success). Without attributing that green to the
// files currently failing, a cycle opened by a named red could never be closed.
test('openRedFiles lists files whose latest run failed, with the failing text', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail', file_hashes: hashes(FILE, 'T1'), head_sha: 'r1' });
  run(root, { verdict: 'fail', test_files: ['tests/test_b.py'], file_hashes: hashes('tests/test_b.py', 'B1') });
  run(root, { verdict: 'pass', test_files: ['tests/test_b.py'], file_hashes: hashes('tests/test_b.py', 'B1') });

  const open = openRedFiles(readLedger(root).events);
  assert.deepStrictEqual(open, [{ file: FILE, hash: 'T1' }], 'test_b closed its cycle and must not appear');
});

test('openRedFiles is empty when nothing is failing', () => {
  const root = tmpRoot();
  run(root, { verdict: 'fail' });
  run(root, { verdict: 'pass' });
  assert.deepStrictEqual(openRedFiles(readLedger(root).events), []);
});

// ------------------------------------------------------------------ pre-snapshot
//
// Round-3 review, CRITICAL and the deepest finding of all three rounds. The
// recorder runs at PostToolUse — AFTER the command — so it hashed the file as it
// stood when the hook fired, not as it stood when the runner read it. One Bash
// line closed the whole chain:
//
//   python -c "open('t_x.py','w').write(WEAK)" ; pytest t_x.py ; git checkout t_x.py
//
// The ledger recorded pass@hash(STRONG) for a run of WEAK. fileState(STRONG) then
// showed latest=pass (unlocked) and G43's cycle compared STRONG against STRONG
// (silent). Neither gate saw anything, because neither write verb is one
// bash-targets recognises.
//
// The fix uses a hook that is ALREADY wired: pre-bash-gate runs as
// PreToolUse(Bash), so it can record the pre-run hashes. The recorder then uses
// those, and refuses to attribute a verdict to a file whose text changed during
// the command — we genuinely cannot tell which text produced that verdict.

const { readSnapshot, writeSnapshot, snapshotHashes } = require('../.claude/hooks/lib/red-phase-ledger');

test('writeSnapshot/readSnapshot round-trip the pre-run hashes for a command', () => {
  const root = tmpRoot();
  writeSnapshot(root, 'pytest tests/test_a.py', { 'tests/test_a.py': 'PRE' });
  const snap = readSnapshot(root, 'pytest tests/test_a.py');
  assert.deepStrictEqual(snap, { 'tests/test_a.py': 'PRE' });
});

test('readSnapshot ignores a snapshot taken for a DIFFERENT command', () => {
  const root = tmpRoot();
  writeSnapshot(root, 'pytest tests/test_a.py', { 'tests/test_a.py': 'PRE' });
  assert.deepStrictEqual(readSnapshot(root, 'pytest tests/test_b.py'), {});
});

test('readSnapshot returns {} when none was taken', () => {
  assert.deepStrictEqual(readSnapshot(tmpRoot(), 'pytest'), {});
});

// The load-bearing behaviour: prefer the PRE-run hash, and drop any file whose
// text moved during the command.
test('snapshotHashes prefers the pre-run hash and drops files that changed mid-run', () => {
  const pre = { stable: 'A', moved: 'B' };
  const post = { stable: 'A', moved: 'C' };
  const got = snapshotHashes(['stable', 'moved'], pre, post);
  assert.deepStrictEqual(got, { files: ['stable'], hashes: { stable: 'A' } });
});

test('snapshotHashes falls back to the post hash when no snapshot exists', () => {
  const got = snapshotHashes(['a'], {}, { a: 'POST' });
  assert.deepStrictEqual(got, { files: ['a'], hashes: { a: 'POST' } });
});
