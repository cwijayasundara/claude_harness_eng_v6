'use strict';

// Test write-lock decision (gap G42). Pure logic — no fs, no git. Wiring lives in
// hooks/pre-write-gate.js (Edit/Write/MultiEdit) and hooks/pre-bash-gate.js
// (sed/tee/patch), because a lock that covers only the native edit tools is
// theatre when the agent has a shell.
//
// ONE invariant: while a test is failing, you fix the PRODUCTION code, not the
// test. Editing a currently-red test is the cheap way to go green without the
// feature working — ImpossibleBench puts that behaviour at 50-55% for frontier
// models, and read-only test paths was the strongest single mitigation measured.
//
// Deliberately narrow. The lock is NOT "tests are read-only during a task":
//   - green-first files (characterization pin-downs) never lock, so the legacy
//     lane's permitted matcher repair still works;
//   - a red-first file unlocks the moment it legitimately goes green, so adding
//     the next test to the same file is not blocked by your own passing work.
// See red-phase-ledger.js#fileState for why `open` is the right key.

const { fileState } = require('./red-phase-ledger');
const { isTestFile } = require('./tdd');

function allow(reason) {
  return { blocked: false, reason, redSha: null, message: null };
}

function blockedMessage(redSha) {
  return (
    'BLOCKED: this test is currently FAILING — fix the production code, not the test.\n' +
    `Red phase recorded at ${redSha || 'unknown sha'}.\n` +
    'A failing test is a specification you have not met yet. Editing it to pass is how a\n' +
    'suite goes green while the feature stays broken.\n' +
    'Legitimate ways forward:\n' +
    '  - change the production code until the test passes (the intended path);\n' +
    '  - if the test itself is genuinely wrong, say so explicitly and re-run it so the\n' +
    '    ledger records the correction, rather than editing it silently;\n' +
    '  - legacy code with no red phase to honour: HARNESS_TEST_LOCK=off.\n'
  );
}

/**
 * @param {object} args
 * @param {{state: string, events: object[], errors: string[]}} args.ledger readLedger() result
 * @param {string} args.taskId  active task id
 * @param {string} args.filePath path being written
 * @param {object} args.env    process.env (or a stub)
 * @returns {{blocked: boolean, reason: string, redSha: string|null, message: string|null}}
 */
// A gate that cannot read its own evidence must fail loud, never open — the rule
// gate-registry.js applies to a missing pack module. A tampered ledger is
// precisely the state an agent would engineer to unlock a test.
function ledgerInvalid(ledger) {
  return {
    blocked: true,
    reason: 'ledger-invalid',
    redSha: null,
    message:
      'BLOCKED: the red-phase ledger failed its integrity check, so the lock cannot be\n' +
      'evaluated. Refusing to treat an unreadable record as a passing one.\n' +
      `Errors: ${(ledger.errors || []).join('; ')}\n`,
  };
}

function decideLock({ ledger, filePath, contentHash, env = {} }) {
  if (String(env.HARNESS_TEST_LOCK || '').toLowerCase() === 'off') return allow('bypass');

  const rel = String(filePath || '').replace(/\\/g, '/');
  if (!isTestFile(rel)) return allow('not-a-test');
  if (ledger && ledger.state === 'invalid') return ledgerInvalid(ledger);
  // No readable on-disk content means nothing was ever run against this text (a
  // brand-new test file). Creating one is always fine; EDITING a failing one is
  // the tamper.
  if (!contentHash) return allow('unseen');

  const state = fileState((ledger && ledger.events) || [], rel, contentHash);
  if (!state) return allow('unseen');
  if (!state.redFirst) return allow('green-first');
  if (!state.open) return allow('cycle-closed');
  return { blocked: true, reason: 'open-red', redSha: state.redSha, message: blockedMessage(state.redSha) };
}

module.exports = { decideLock };
