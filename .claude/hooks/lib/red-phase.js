'use strict';

// Red-phase classification (gap G41). Pure logic only — no fs, no git. Ledger IO
// and the PostToolUse plumbing live in hooks/red-phase-record.js, the same
// lib/hook split test-deletion-gate.js and cycle-gate.js use.
//
// ONE question: did this Bash command run tests, what did they say, and which
// test files does the run name?
//
// The harness proved test EXISTENCE (`tdd-test-first`) but never test ORDERING —
// its own comment says "pair with tdd-guard for red-green ordering". A test
// written to match code already written passed that gate. Recording a real
// failing run is what turns "a test exists" into "a test failed first".
//
// The env-broken verdict is the load-bearing distinction. `pytest` exiting
// non-zero because pytest is not installed is NOT a red phase; recording it as
// one would arm a lock against a test that never ran. That signature list is
// toolchain.js's MISSING_SIGNATURES, reused rather than copied — two lists would
// drift, and the duplication ratchet would bite the copy.

const { unavailable } = require('./toolchain');
const { isTestFile } = require('./tdd');
const { parseCommand } = require('./red-phase-command');

// Per-runner (fail, pass) output signatures. A fail signature wins: a partially
// green run is still red.
//
// node-test carries BOTH reporter shapes on purpose. Node >=22 defaults to the
// `spec` reporter even non-TTY (`ℹ fail 1`); only `--test-reporter=tap` gives
// `# fail 1`. Matching TAP alone made every real run of this repo's own suite
// classify as env-broken, so nothing was ever recorded — a dead control that
// hand-written test fixtures could not see.
const SIGNATURES = {
  pytest: [/\bFAILED\b|\b\d+ failed\b|\berror\b.*\bcollecting\b/i, /\b\d+ passed\b/i],
  vitest: [/^\s*FAIL\b|\bfailed\b\s*\(/im, /\bpassed\b/i],
  // `Test Suites:` is a SEPARATE line from `Tests:`, and a suite that fails to
  // compile reports `Test Suites: 1 failed` while `Tests:` shows only the ones
  // that ran — all passing. Keying the failure on `Tests:` alone read that as a
  // clean pass, closing a red->green cycle on a run that never executed the test.
  jest: [/^\s*FAIL\b|Tests?(?: Suites)?:.*\bfailed\b/im, /Tests:.*\bpassed\b|\bpassed\b/i],
  'node-test': [/^[ℹ#]\s*fail\s+[1-9]/im, /^[ℹ#]\s*fail\s+0\b/im],
  'go-test': [/^(?:FAIL|---\s*FAIL)\b/im, /^ok\b|\bPASS\b/im],
};

// How many tests actually EXECUTED. A run that executed none exits 0 and looks
// like a pass; treating it as one closes the red->green cycle and releases the
// lock while the failing test was never run. Reachable with a single flag, so it
// is the cheapest bypass of the whole chain.
const COUNTS = [
  /^[ℹ#]\s*pass\s+(\d+)/im,      // node --test, both reporters
  /\b(\d+)\s+passed\b/i,          // pytest, vitest, jest
  /Tests:.*?(\d+)\s+passed/i,     // jest summary
];

function executedCount(text) {
  for (const re of COUNTS) {
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  return null; // unknown — do not infer zero
}

// `npm test` delegates to whatever the project configured, so try every dialect.
function unionSignature(index) {
  const parts = Object.values(SIGNATURES).map((s) => s[index]);
  return (text) => parts.some((re) => re.test(text));
}

/**
 * pass | fail | no-tests | env-broken. Never guesses: output matching no known
 * signature is env-broken, not a silent pass.
 * @returns {'pass'|'fail'|'no-tests'|'env-broken'}
 */
function parseVerdict(runner, text) {
  const s = String(text || '');
  if (!s.trim() || unavailable(s)) return 'env-broken';
  const sig = SIGNATURES[runner];
  const failed = sig ? sig[0].test(s) : unionSignature(0)(s);
  if (failed) return 'fail';
  const passed = sig ? sig[1].test(s) : unionSignature(1)(s);
  if (!passed) return 'env-broken';
  // A green run that ran nothing proves nothing.
  return executedCount(s) === 0 ? 'no-tests' : 'pass';
}

// `FAILED tests/test_foo.py::test_a - AssertionError`
const PYTEST_FAIL = /^FAILED\s+([^\s:]+)/gm;
// `FAIL  src/a.test.ts > adds`
const JS_FAIL = /^\s*FAIL\s+(\S+)/gm;

function matchAll(re, text) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * Test files the output names as failing. Only what is nameable — a bare
 * `npm test` whose output names no file yields [], and the commit-time G43 proof
 * is the backstop for that case.
 * @returns {string[]} sorted, deduped
 */
function failingTestFiles(runner, text) {
  const s = String(text || '');
  const found = runner === 'pytest'
    ? matchAll(PYTEST_FAIL, s)
    : ['vitest', 'jest'].includes(runner)
      ? matchAll(JS_FAIL, s)
      : [...matchAll(PYTEST_FAIL, s), ...matchAll(JS_FAIL, s)];
  return [...new Set(found.filter(isTestFile))].sort();
}

/**
 * Which files this run's verdict actually applies to.
 *
 * The verdict is RUN-level; applying it to every file the command named recorded
 * passing tests as failing. `pytest a b` where only `a` fails would lock `b`, and
 * any later legitimate edit of `b` then raised a false G43 block.
 *
 * A FAIL therefore attributes only to files the output names as failing — except
 * when the command named exactly one test file, where it is unambiguous. A PASS
 * attributes to everything the command named, since a green run genuinely
 * exonerates all of them.
 */
function attributeFiles(parsed, verdict, text) {
  if (verdict !== 'pass' && verdict !== 'fail') return []; // nothing was proved
  if (verdict === 'pass') return [...new Set(parsed.paths)].sort();
  const failing = failingTestFiles(parsed.runner, text);
  if (failing.length) return failing;
  return parsed.paths.length === 1 ? [...parsed.paths] : [];
}

/**
 * One record-ready verdict for a Bash tool call.
 * @param {{command: string, text: string}} run
 * @returns {{isTestRun: boolean, runner: string|null, verdict: string|null, testFiles: string[]}}
 */
function classifyRun({ command, text }) {
  const parsed = parseCommand(command);
  if (!parsed.isTestRun) {
    return { isTestRun: false, runner: null, verdict: null, testFiles: [], filtered: false };
  }
  const verdict = parseVerdict(parsed.runner, text);
  return {
    isTestRun: true,
    runner: parsed.runner,
    verdict,
    testFiles: attributeFiles(parsed, verdict, text),
    scopePaths: parsed.scopePaths,
    filtered: parsed.filtered,
  };
}

module.exports = { parseCommand, parseVerdict, failingTestFiles, classifyRun };
