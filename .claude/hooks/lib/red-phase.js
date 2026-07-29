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
// Flags that select WHICH tests run. The agent chooses the subset, so a green
// filtered run says nothing about the test that was failing — it cannot close a
// red->green cycle.
const FILTER = /^(--test-name-pattern|--test-skip-pattern|-k|--filter|-t|--testNamePattern|--grep|-run)(=|$)/;

// Prefixes that delegate to the real runner: strip and re-resolve.
const DELEGATES = new Set(['uv', 'npx', 'pnpm', 'yarn', 'bunx', 'poetry', 'pipenv', 'rye', 'hatch', 'bun']);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const DELEGATE_VERBS = new Set(['run', 'exec', 'dlx', 'x']);

// `CI=1 npm test`, `FOO=bar pytest` — leading VAR=value assignments are env, not
// the command.
function stripEnvAssignments(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  return tokens.slice(i);
}

function stripDelegates(tokens) {
  let t = tokens;
  // `uv run X`, `uv run --frozen X`, `npx X`, `pnpm exec X`, `poetry run X`
  while (t.length > 1 && DELEGATES.has(baseName(t[0]))) {
    let next = DELEGATE_VERBS.has(t[1]) ? 2 : 1;
    // Skip the delegate's OWN flags (`uv run --frozen pytest`) — otherwise the
    // head becomes `--frozen` and the run is not recognised at all.
    while (next < t.length && t[next].startsWith('-')) next += 1;
    if (next >= t.length) return t;
    t = t.slice(next);
  }
  return t;
}

// `npm test` / `npm t` / `npm run test:unit` is a package SCRIPT, not a delegate —
// it has to be resolved before stripDelegates, which would otherwise eat the
// `pnpm` and leave a bare `test`.
function packageScriptRunner(tokens) {
  if (!PKG_MANAGERS.has(baseName(tokens[0]))) return null;
  const verb = tokens[1];
  const script = tokens[2];
  if (verb === 'test' || verb === 't') return 'npm-test';
  // `npm run test`, `npm run test:unit`, `npm run test-integration`
  if ((verb === 'run' || verb === 'run-script') && typeof script === 'string' && /^test([:\-].+)?$/.test(script)) {
    return 'npm-test';
  }
  return null;
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

// Flags whose NEXT token is a value, not a path. Without this, `pytest --maxfail 2`
// would read `2` as scope.
const FLAG_WITH_VALUE = /^(-k|-t|-n|-m|--maxfail|--test-name-pattern|--test-reporter|--reporter|--filter|--grep|-run)$/;

/**
 * Positional path arguments — the SCOPE the run covered.
 *
 * Distinct from `paths` (concrete test FILES). A directory or package argument
 * (`pytest tests/unit`, `go test ./pkg/foo`) names no file and is not a filter
 * flag, so without this it was indistinguishable from a bare whole-suite run —
 * and one subset run could close open cycles for files it never executed.
 * Empty means the command genuinely covers everything.
 */
function scopePathTokens(tokens, runner) {
  // Skip the runner invocation itself (`npm run test:unit`, `go test`, `python -m pytest`).
  const args = [];
  let i = 1;
  if (runner === 'npm-test' || runner === 'go-test') i = 2;
  if (tokens[1] === 'run' || tokens[1] === '-m') i = 3;
  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (FLAG_WITH_VALUE.test(t)) { i += 1; continue; }
    if (t.startsWith('-')) continue;
    args.push(t);
  }
  return args;
}

/**
 * @param {string} command raw Bash command line
 * @returns {{isTestRun: boolean, runner: string|null, paths: string[]}}
 */
function parseCommand(command) {
  const none = { isTestRun: false, runner: null, paths: [], filtered: false };
  const segments = lex(command);
  if (!segments) return none; // unbalanced quotes — fail open, never guess
  for (const seg of segments) {
    const tokens = stripEnvAssignments(seg.tokens);
    const runner = resolveRunner(tokens);
    if (!runner) continue;
    if (tokens.some((t) => WATCH.test(t))) return none; // no terminal verdict
    const stripped = stripEnvAssignments(seg.tokens);
    return {
      isTestRun: true,
      runner,
      paths: testPathTokens(tokens),
      scopePaths: scopePathTokens(stripped, runner),
      filtered: tokens.some((t) => FILTER.test(t)),
    };
  }
  return none;
}

// Per-runner (fail, pass) output signatures. Ordered: a fail signature wins,
// because a partially-green run is still red.
//
// node-test carries BOTH reporter shapes on purpose. Node >=22 defaults to the
// `spec` reporter even non-TTY (`ℹ fail 1`); only `--test-reporter=tap` gives
// `# fail 1`. Matching TAP alone made every real run of this repo's own suite
// classify as env-broken, so nothing was ever recorded — a dead control that
// hand-written test fixtures could not see.
const SIGNATURES = {
  pytest: [/\bFAILED\b|\b\d+ failed\b|\berror\b.*\bcollecting\b/i, /\b\d+ passed\b/i],
  vitest: [/^\s*FAIL\b|\bfailed\b\s*\(/im, /\bpassed\b/i],
  jest: [/^\s*FAIL\b|Tests:.*\bfailed\b/im, /Tests:.*\bpassed\b|\bpassed\b/i],
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
