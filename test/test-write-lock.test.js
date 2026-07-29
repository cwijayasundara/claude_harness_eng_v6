'use strict';

// Gap G42: test write-lock. `test-deletion-gate.js` (G31) catches a test being
// DELETED or newly SKIPPED at commit time. Nothing caught the cheaper move —
// rewriting an assertion mid-loop so a failing test passes without the
// production code changing. ImpossibleBench measures that behaviour at 50-55%
// for frontier models on impossible tests, and read-only test paths was the
// strongest single mitigation, so this is the gap worth closing first.
//
// Pure decision logic only. Wiring into pre-write-gate.js (Edit/Write) and
// pre-bash-gate.js (sed/tee/patch) is exercised separately — a lock that covers
// only the native edit tools is theatre when the agent has a shell.

const { test } = require('node:test');
const assert = require('node:assert');
const { decideLock } = require('../.claude/hooks/lib/test-write-lock');

const TEST_FILE = 'tests/test_a.py';

function ledgerOf(events, state = 'valid') {
  return { state, events, errors: state === 'invalid' ? ['event hash mismatch at 1'] : [] };
}

const H = 'content-hash-of-the-failing-text';

function ev(over = {}) {
  return {
    task_id: 'T-1',
    verdict: 'fail',
    test_files: [TEST_FILE],
    file_hashes: { [TEST_FILE]: H },
    head_sha: 'red111',
    ...over,
  };
}

function decide(over = {}) {
  return decideLock({
    ledger: ledgerOf([ev()]),
    filePath: TEST_FILE,
    contentHash: H,
    env: {},
    ...over,
  });
}

test('blocks editing a test whose latest run is red', () => {
  const d = decide();
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.reason, 'open-red');
  assert.strictEqual(d.redSha, 'red111');
  assert.match(d.message, /failing/i);
  // The message must point at the fix, not just refuse — the harness's sensors
  // coach (see sensor-guidance.js), they do not merely deny.
  assert.match(d.message, /production code/i);
});

test('allows editing once the red-first file has gone green', () => {
  const d = decide({ ledger: ledgerOf([ev(), ev({ verdict: 'pass' })]) });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'cycle-closed');
});

test('allows editing a green-first (pin-down) file even while it is failing', () => {
  const events = [ev({ verdict: 'pass' }), ev({ verdict: 'fail', head_sha: 'flip999' })];
  const d = decide({ ledger: ledgerOf(events) });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'green-first');
});

test('allows a file the ledger has never seen', () => {
  const d = decide({ filePath: 'tests/test_new.py' });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'unseen');
});

test('allows non-test files without consulting the ledger', () => {
  const d = decide({ filePath: 'src/app.py' });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'not-a-test');
});

// C1 regression: task_id used to be part of the key, which made it a
// self-service unlock — declare a different task and every lock evaporated.
test('the lock does NOT depend on the declared task', () => {
  const d = decide({ ledger: ledgerOf([ev({ task_id: 'some-other-task' })]) });
  assert.strictEqual(d.blocked, true, 'a red on this text locks it regardless of task');
  assert.strictEqual(d.reason, 'open-red');
});

// I3 regression: the lock is keyed on the text that was RUN. Different text on
// disk means this content was never observed, so there is nothing to honour.
test('a different content hash is unseen, not locked', () => {
  const d = decide({ contentHash: 'some-other-text' });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'unseen');
});

test('an unreadable file (no content hash) is allowed — creating a test is not the tamper', () => {
  const d = decide({ contentHash: null });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'unseen');
});

test('HARNESS_TEST_LOCK=off bypasses, mirroring HARNESS_TDD_GATE=off for legacy', () => {
  const d = decide({ env: { HARNESS_TEST_LOCK: 'off' } });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'bypass');
});

// A gate that cannot read its own evidence must not be indistinguishable from a
// passing one — the same fail-loud rule gate-registry.js applies to a missing
// pack module.
test('BLOCKS when the ledger is tampered — a corrupt record is not a pass', () => {
  const d = decide({ ledger: ledgerOf([ev()], 'invalid') });
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.reason, 'ledger-invalid');
  assert.match(d.message, /hash mismatch/);
});

test('allows everything when no ledger exists yet', () => {
  const d = decide({ ledger: { state: 'absent', events: [], errors: [] } });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'unseen');
});

test('normalises path separators so a Windows-style path is still matched', () => {
  const d = decide({ filePath: 'tests\\test_a.py' });
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.reason, 'open-red');
});
