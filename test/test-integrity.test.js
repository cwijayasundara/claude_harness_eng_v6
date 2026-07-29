'use strict';

// Gap G43: test-integrity proof. G42 blocks the tamper inside a session, but a
// turn-level gate is steppable — the agent can disable hooks, work outside
// Claude Code, or commit with --no-verify. The pack's failure mode #6 is exactly
// this: a turn gate needs a merge-level backstop with no override. This is that
// backstop, at pre-commit and again in CI.
//
// THE INVARIANT, and why it is a red→green PAIR rather than a snapshot:
//
//   A test file must not change between the run that made it RED and the run
//   that made it GREEN.
//
// If it changed, the test was weakened to pass. If it did not, production code
// is what made it pass. Comparing against a single anchor cannot tell those
// apart — the tamperer simply edits the test and re-runs, and every
// single-anchor rule (latest red hash, latest green hash) then agrees with
// itself. The pair is what carries the proof.
//
// Legitimate flows this must NOT flag:
//   - editing a test AFTER its cycle closed (refactoring a passing test);
//   - characterization pin-downs, which are green-first and have no pair at all.

const { test } = require('node:test');
const assert = require('node:assert');
const { integrityFindings } = require('../.claude/hooks/lib/test-integrity');

const FILE = 'tests/test_a.py';

function ev(verdict, hash, over = {}) {
  return {
    task_id: 'T-1',
    verdict,
    test_files: [FILE],
    file_hashes: { [FILE]: hash },
    head_sha: 'sha-' + hash,
    ...over,
  };
}

test('passes when the test text is identical at red and at green', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H1')];
  assert.deepStrictEqual(integrityFindings(events), []);
});

test('BLOCKS when the test changed between red and green — the tamper', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H2')];
  const found = integrityFindings(events);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'test-changed-between-red-and-green');
  assert.strictEqual(found[0].file, FILE);
  assert.strictEqual(found[0].redSha, 'sha-H1');
  assert.match(found[0].detail, /weakened|changed/i);
});

test('a still-red test has no pair yet and is not a finding', () => {
  assert.deepStrictEqual(integrityFindings([ev('fail', 'H1')]), []);
});

test('ignores green-first (pin-down) files entirely — they have no red phase to honour', () => {
  const events = [ev('pass', 'H1'), ev('fail', 'H2'), ev('pass', 'H3')];
  assert.deepStrictEqual(integrityFindings(events), []);
});

test('allows refactoring the test AFTER the pair closed', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H1'), ev('pass', 'H2')];
  assert.deepStrictEqual(integrityFindings(events), []);
});

// I4 regression. The first version anchored on the LAST red before the green,
// which let a weakened test launder itself: strip assertions but stay red,
// re-run (re-anchoring the pair to the weakened text), then fix the one
// surviving assertion — red and green hashes then matched and the gate said
// nothing. Anchoring on the FIRST red of the cycle makes any change between
// failing and passing visible, including one that kept it failing.
//
// This also means correcting a test you believe is genuinely wrong now SURFACES
// rather than passing silently. That is intended: from the outside, correcting
// and weakening are indistinguishable, so a human should see it.
test('BLOCKS a test edited while still red, then fixed — the re-anchor laundry', () => {
  const events = [ev('fail', 'H1'), ev('fail', 'H2'), ev('pass', 'H2')];
  const found = integrityFindings(events);
  assert.strictEqual(found.length, 1, 'the intra-cycle edit must not be laundered by a re-run');
  assert.strictEqual(found[0].kind, 'test-changed-between-red-and-green');
  assert.strictEqual(found[0].redSha, 'sha-H1', 'anchored on the FIRST red of the cycle');
});

test('catches the tamper on the SECOND cycle, not just the first', () => {
  const events = [
    ev('fail', 'H1'), ev('pass', 'H1'), // clean first cycle
    ev('fail', 'H2'), ev('pass', 'H3'), // weakened second cycle
  ];
  const found = integrityFindings(events);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].redSha, 'sha-H2');
});

// C1 regression: the first version scoped findings by task_id, so declaring a
// different task (or none) emptied the event set and every cycle vanished
// unchecked. The gate is now task-agnostic.
test('task_id cannot hide a finding', () => {
  const mixed = [ev('fail', 'H1', { task_id: 'T-0' }), ev('pass', 'H2', { task_id: 'T-9' })];
  const found = integrityFindings(mixed);
  assert.strictEqual(found.length, 1, 'a cycle split across declared tasks is still a cycle');
  assert.strictEqual(found[0].kind, 'test-changed-between-red-and-green');
});

test('reports each offending file once, even across several test files', () => {
  const two = (verdict, ha, hb) => ({
    task_id: 'T-1',
    verdict,
    test_files: ['tests/test_a.py', 'tests/test_b.py'],
    file_hashes: { 'tests/test_a.py': ha, 'tests/test_b.py': hb },
    head_sha: 'sha',
  });
  const found = integrityFindings([two('fail', 'A1', 'B1'), two('pass', 'A2', 'B1')]);
  assert.deepStrictEqual(found.map((f) => f.file), ['tests/test_a.py']);
});

test('a run missing a hash for a file is reported, never silently passed', () => {
  const events = [
    { task_id: 'T-1', verdict: 'fail', test_files: [FILE], file_hashes: {}, head_sha: 'sha-r' },
    ev('pass', 'H1'),
  ];
  const found = integrityFindings(events);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'unverifiable-red-phase');
});
