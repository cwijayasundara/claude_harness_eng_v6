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
//   - refactoring a test after it has gone green (happens after the pair closed);
//   - correcting a genuinely wrong test, then re-running: the correction lands as
//     a NEW red anchor, and the new pair is internally consistent;
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
  assert.deepStrictEqual(integrityFindings(events, 'T-1'), []);
});

test('BLOCKS when the test changed between red and green — the tamper', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H2')];
  const found = integrityFindings(events, 'T-1');
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'test-changed-between-red-and-green');
  assert.strictEqual(found[0].file, FILE);
  assert.strictEqual(found[0].redSha, 'sha-H1');
  assert.match(found[0].detail, /weakened|changed/i);
});

test('a still-red test has no pair yet and is not a finding', () => {
  assert.deepStrictEqual(integrityFindings([ev('fail', 'H1')], 'T-1'), []);
});

test('ignores green-first (pin-down) files entirely — they have no red phase to honour', () => {
  const events = [ev('pass', 'H1'), ev('fail', 'H2'), ev('pass', 'H3')];
  assert.deepStrictEqual(integrityFindings(events, 'T-1'), []);
});

test('allows refactoring the test AFTER the pair closed', () => {
  const events = [ev('fail', 'H1'), ev('pass', 'H1'), ev('pass', 'H2')];
  assert.deepStrictEqual(integrityFindings(events, 'T-1'), []);
});

// The declared way to correct a test you believe is wrong: say so and re-run, so
// the correction is visible in the ledger as a new anchor instead of silent.
test('allows a corrected test that was re-run red before going green', () => {
  const events = [ev('fail', 'H1'), ev('fail', 'H2'), ev('pass', 'H2')];
  assert.deepStrictEqual(integrityFindings(events, 'T-1'), []);
});

test('catches the tamper on the SECOND cycle, not just the first', () => {
  const events = [
    ev('fail', 'H1'), ev('pass', 'H1'), // clean first cycle
    ev('fail', 'H2'), ev('pass', 'H3'), // weakened second cycle
  ];
  const found = integrityFindings(events, 'T-1');
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].redSha, 'sha-H2');
});

test('scopes to the active task', () => {
  const events = [ev('fail', 'H1', { task_id: 'T-0' }), ev('pass', 'H2', { task_id: 'T-0' })];
  assert.deepStrictEqual(integrityFindings(events, 'T-1'), []);
  assert.strictEqual(integrityFindings(events, 'T-0').length, 1);
});

test('reports each offending file once, even across several test files', () => {
  const two = (verdict, ha, hb) => ({
    task_id: 'T-1',
    verdict,
    test_files: ['tests/test_a.py', 'tests/test_b.py'],
    file_hashes: { 'tests/test_a.py': ha, 'tests/test_b.py': hb },
    head_sha: 'sha',
  });
  const found = integrityFindings([two('fail', 'A1', 'B1'), two('pass', 'A2', 'B1')], 'T-1');
  assert.deepStrictEqual(found.map((f) => f.file), ['tests/test_a.py']);
});

test('a run missing a hash for a file is reported, never silently passed', () => {
  const events = [
    { task_id: 'T-1', verdict: 'fail', test_files: [FILE], file_hashes: {}, head_sha: 'sha-r' },
    ev('pass', 'H1'),
  ];
  const found = integrityFindings(events, 'T-1');
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'unverifiable-red-phase');
});
