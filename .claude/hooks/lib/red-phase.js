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

const { lex } = require('./shell-lex');
const { unavailable } = require('./toolchain');
const { isTestFile } = require('./tdd');

// Wrapper scripts that SPAWN a test command as a child process. PostToolUse only
// ever sees the wrapper, and its child's failure is deliberate (the pin-down
// mutation-smoke checkpoint flips production code on purpose), so a wrapper
// invocation must never be read as a first-party test run.
const WRAPPER = /^\.claude\/scripts\//;
const WATCH = /^--watch/;

// Prefixes that delegate to the real runner: strip and re-resolve.
const DELEGATES = new Set(['uv', 'npx', 'pnpm', 'yarn', 'bunx']);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

function stripDelegates(tokens) {
  let t = tokens;
  // `uv run X`, `npx X`, `pnpm exec X`, `yarn dlx X`
  while (t.length > 1 && DELEGATES.has(t[0])) {
    t = t.slice(['run', 'exec', 'dlx'].includes(t[1]) ? 2 : 1);
  }
  return t;
}

// `npm test` / `pnpm run test` is a package SCRIPT, not a delegate — it has to be
// resolved before stripDelegates, which would otherwise eat the `pnpm` and leave
// a bare `test`.
function packageScriptRunner(tokens) {
  if (!PKG_MANAGERS.has(baseName(tokens[0]))) return null;
  const isScript = tokens[1] === 'test' || (tokens[1] === 'run' && tokens[2] === 'test');
  return isScript ? 'npm-test' : null;
}

function baseName(token) {
  return String(token || '').split('/').pop();
}

// A runner id, or null when these tokens are not a test invocation.
function resolveRunner(tokens) {
  if (!tokens.length) return null;
  const script = packageScriptRunner(tokens);
  if (script) return script;
  const t = stripDelegates(tokens);
  const head = baseName(t[0]);
  if (head === 'node' && t.some((x) => WRAPPER.test(x))) return null; // wrapper script
  if (head === 'node' && t.includes('--test')) return 'node-test';
  if (head === 'go' && t[1] === 'test') return 'go-test';
  if (head === 'python' || head === 'python3') {
    return t[1] === '-m' && baseName(t[2]) === 'pytest' ? 'pytest' : null;
  }
  if (['pytest', 'vitest', 'jest'].includes(head)) return head;
  return null;
}

// Tokens that name a concrete test FILE. `pytest tests/` names a directory, not
// a file, so it contributes no path — the output parse supplies those.
function testPathTokens(tokens) {
  return tokens.filter(
    (t) => !t.startsWith('-') && !t.endsWith('/') && /\.\w+$/.test(t) && isTestFile(t)
  );
}

/**
 * @param {string} command raw Bash command line
 * @returns {{isTestRun: boolean, runner: string|null, paths: string[]}}
 */
function parseCommand(command) {
  const none = { isTestRun: false, runner: null, paths: [] };
  const segments = lex(command);
  if (!segments) return none; // unbalanced quotes — fail open, never guess
  for (const seg of segments) {
    const runner = resolveRunner(seg.tokens);
    if (!runner) continue;
    if (seg.tokens.some((t) => WATCH.test(t))) return none; // no terminal verdict
    return { isTestRun: true, runner, paths: testPathTokens(seg.tokens) };
  }
  return none;
}

// Per-runner (fail, pass) output signatures. Ordered: a fail signature wins,
// because a partially-green run is still red.
const SIGNATURES = {
  pytest: [/\bFAILED\b|\b\d+ failed\b|\berror\b.*\bcollecting\b/i, /\b\d+ passed\b|\bno tests? (?:to run|collected)\b/i],
  vitest: [/^\s*FAIL\b|\bfailed\b\s*\(/im, /\bpassed\b/i],
  jest: [/^\s*FAIL\b|Tests:.*\bfailed\b/im, /Tests:.*\bpassed\b|\bpassed\b/i],
  'node-test': [/^#\s*fail\s+[1-9]/im, /^#\s*fail\s+0\b/im],
  'go-test': [/^(?:FAIL|---\s*FAIL)\b/im, /^ok\b|\bPASS\b/im],
};

// `npm test` delegates to whatever the project configured, so try every dialect.
function unionSignature(index) {
  const parts = Object.values(SIGNATURES).map((s) => s[index]);
  return (text) => parts.some((re) => re.test(text));
}

/**
 * pass | fail | env-broken. Never guesses: output that matches no known
 * signature is env-broken, not a silent pass.
 * @returns {'pass'|'fail'|'env-broken'}
 */
function parseVerdict(runner, text) {
  const s = String(text || '');
  if (!s.trim() || unavailable(s)) return 'env-broken';
  const sig = SIGNATURES[runner];
  const failed = sig ? sig[0].test(s) : unionSignature(0)(s);
  if (failed) return 'fail';
  const passed = sig ? sig[1].test(s) : unionSignature(1)(s);
  return passed ? 'pass' : 'env-broken';
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
 * One record-ready verdict for a Bash tool call.
 * @param {{command: string, text: string}} run
 * @returns {{isTestRun: boolean, runner: string|null, verdict: string|null, testFiles: string[]}}
 */
function classifyRun({ command, text }) {
  const parsed = parseCommand(command);
  if (!parsed.isTestRun) return { isTestRun: false, runner: null, verdict: null, testFiles: [] };
  const verdict = parseVerdict(parsed.runner, text);
  // A run that never happened names no files — recording them would let a
  // broken environment arm a lock, or mark a file green-first that never ran.
  const testFiles = verdict === 'env-broken'
    ? []
    : [...new Set([...parsed.paths, ...failingTestFiles(parsed.runner, text)])].sort();
  return { isTestRun: true, runner: parsed.runner, verdict, testFiles };
}

module.exports = { parseCommand, parseVerdict, failingTestFiles, classifyRun };
