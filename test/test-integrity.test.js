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

// This case used to assert "green-first files are exempt entirely". That was the
// bug: the exemption was PATH-keyed, so one earlier green excused a file forever.
// The text here CHANGES between red (H2) and green (H3), which is exactly the
// tamper — an earlier green must not excuse it.
test('an earlier green does not excuse a later red->green text change', () => {
  const events = [ev('pass', 'H1'), ev('fail', 'H2'), ev('pass', 'H3')];
  const found = integrityFindings(events);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].redSha, 'sha-H2');
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

// Round-2 review, Critical. cyclesFor's green-first short-circuit was PATH-keyed
// while the lock is CONTENT-keyed, so ANY file ever observed green at older text
// was exempt from this gate forever — which is nearly every pre-existing test
// file in a real repo. The short-circuit is gone: the hash comparison already
// gives pin-downs the right answer without it.
test('a file that was green at OLDER text is still checked', () => {
  const events = [ev('pass', 'X'), ev('fail', 'Y'), ev('pass', 'Z')];
  const found = integrityFindings(events);
  assert.strictEqual(found.length, 1, 'routine earlier green must not grant lifetime exemption');
  assert.strictEqual(found[0].redSha, 'sha-Y');
});

// ...and the pin-down case still passes, without needing a special case: the
// flip changes PRODUCTION code, so the pin text is identical at red and green.
test('a pin-down cycle passes on hash equality alone, with no green-first rule', () => {
  const events = [ev('pass', 'P'), ev('fail', 'P'), ev('pass', 'P')];
  assert.deepStrictEqual(integrityFindings(events), []);
});

// ------------------------------------------------------ never-red (advisory)
//
// THE RESIDUAL GAP this addresses, stated plainly: everything above proves "if a
// test was red, it wasn't weakened to go green". None of it proves "every test
// was red first". A tautological test — written to match code that already
// works, passing on its very first run — produces no red record at all, so every
// cycle check is silent. That is failure mode #11 in its most common form, and
// neither independent review round raised it.
//
// mutation-smoke (G7) covers it from the other direction (a test that doesn't
// bite leaves survivors), but only inside an /auto build — it early-returns on
// inAutoBuild. /change, /vibe, /feature and ordinary work have nothing.
//
// ADVISORY, not blocking, and the reason is honest rather than cautious: at the
// ledger level a characterization pin-down is INDISTINGUISHABLE from a
// tautological test. Both are green-only by design (pinning-down-behavior Step 3
// runs pins green against unmodified code). Blocking would fail the legacy lane
// for doing exactly what its skill instructs. Surfacing the fact that a test was
// never observed failing is the honest ceiling here.

test('flags a new test file that was never observed failing', () => {
  const events = [ev('pass', 'H1')];
  const found = integrityFindings(events, { newTestFiles: [FILE] });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'never-red-test');
  assert.strictEqual(found[0].advisory, true, 'must not block — pin-downs look identical');
  assert.match(found[0].detail, /never observed failing/i);
});

test('does not flag a new test file that WAS observed failing', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H1')];
  assert.deepStrictEqual(integrityFindings(events, { newTestFiles: [FILE] }), []);
});

test('flags a new test file with no ledger record at all', () => {
  const found = integrityFindings([ev('fail', 'X')], { newTestFiles: ['tests/brand_new.py'] });
  assert.deepStrictEqual(found.map((f) => f.kind), ['never-red-test']);
});

test('says nothing about files that are not newly added', () => {
  assert.deepStrictEqual(integrityFindings([ev('pass', 'H1')], { newTestFiles: [] }), []);
  assert.deepStrictEqual(integrityFindings([ev('pass', 'H1')]), [], 'opts is optional');
});

// A blocking finding and an advisory one must stay separable, or the gate cannot
// block on one while merely reporting the other.
test('advisory findings are distinguishable from blocking ones', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H2')]; // real tamper
  const found = integrityFindings(events, { newTestFiles: ['tests/other_new.py'] });
  const blocking = found.filter((f) => !f.advisory);
  const advisory = found.filter((f) => f.advisory);
  assert.deepStrictEqual(blocking.map((f) => f.kind), ['test-changed-between-red-and-green']);
  assert.deepStrictEqual(advisory.map((f) => f.kind), ['never-red-test']);
});

// Self-review after round 3 (its reviewer died twice on server errors). "Never
// observed failing" is TRIVIALLY true when nothing was observed at all, so an
// empty ledger accused every newly-added test file. Two commits after wiring the
// recorder that is a wall of notes about files it simply had not seen yet — and an
// advisory that cries wolf on day one is an advisory people learn to skip.
test('an empty ledger accuses nothing — vacuous evidence is not a finding', () => {
  const found = integrityFindings([], { newTestFiles: ['tests/a_test.py', 'tests/b_test.py'] });
  assert.deepStrictEqual(found, []);
});

test('once the ledger has ANY evidence, never-red applies again', () => {
  const found = integrityFindings([ev('fail', 'X')], { newTestFiles: ['tests/b_test.py'] });
  assert.deepStrictEqual(found.map((f) => f.kind), ['never-red-test']);
});
