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

function ev(over = {}) {
  return { task_id: 'T-1', verdict: 'fail', test_files: [TEST_FILE], head_sha: 'red111', ...over };
}

function decide(over = {}) {
  return decideLock({
    ledger: ledgerOf([ev()]),
    taskId: 'T-1',
    filePath: TEST_FILE,
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

test('scopes the lock to the active task', () => {
  const d = decide({ taskId: 'T-2' });
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
