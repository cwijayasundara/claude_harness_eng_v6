'use strict';

// Test-command parsing for the red-phase recorder (gap G41). Pure: no fs, no git.
// Split out of red-phase.js when that file crossed the 300-line cap — one file
// was doing two jobs, "what did this command ask for" and "what did the runner
// say back".
//
// Answers three things about a Bash command line:
//   runner      — which test runner, with env assignments and delegates
//                 (`uv run --frozen`, `npx`, `poetry run`, `npm run test:unit`)
//                 stripped away.
//   paths       — the concrete test FILES it named.
//   scopePaths  — the positional path arguments, i.e. what the run COVERED. A
//                 directory argument names no file, so without this a subset run
//                 looked exactly like a whole-suite sweep.
//   filtered    — whether the agent chose which tests execute. A filtered run can
//                 never close a red->green cycle.

const { lex } = require('./shell-lex');
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
// EXCLUSION flags count as filters too, and their omission was a full-chain
// bypass: `pytest tests/unit --ignore=tests/unit/test_a.py` looked like a
// whole-suite green over tests/unit and closed test_a's open cycle without ever
// running it. Selecting a subset by removal is still selecting a subset.
//
// Tested against the RUNNER's argv, never the raw command — `python -m pytest`
// contains `-m`, and matching that would mark every such run filtered so nothing
// would ever be recorded.
const FILTER = new RegExp(
  '^(?:'
  + '--test-name-pattern|--test-skip-pattern|--testNamePattern|--testPathPattern'
  + '|-k|-t|--filter|--grep|-run|-m'
  + '|--ignore|--ignore-glob|--deselect|--exclude|--skip|-skip|--shard|--changed|--onlyFailures'
  + ')(?:=|$)'
);

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

/**
 * The runner's ARGUMENTS, with the whole invocation prefix removed:
 *   `uv run --frozen pytest -k x`   -> ['-k', 'x']
 *   `python -m pytest tests/unit`   -> ['tests/unit']
 *   `npm run test:unit -- -k x`     -> ['--', '-k', 'x']
 *   `go test ./pkg/foo`             -> ['./pkg/foo']
 *
 * Paths, scope and filter flags are ALL derived from this rather than the raw
 * command. Judging flags on raw tokens misreads the `-m` in `python -m pytest` as
 * a pytest marker filter; deriving scope from raw tokens made `uv run pytest`
 * report a scope of ['pytest'].
 */
function runnerArgv(tokens, runner) {
  const t = stripDelegates(tokens);
  const head = baseName(t[0]);
  if ((head === 'python' || head === 'python3') && t[1] === '-m') return t.slice(3);
  if (runner === 'npm-test') return t[1] === 'run' || t[1] === 'run-script' ? t.slice(3) : t.slice(2);
  if (runner === 'go-test') return t.slice(2);
  return t.slice(1);
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
const FLAG_WITH_VALUE = new RegExp(
  '^(?:'
  + '-k|-t|-n|-m|--maxfail|--test-name-pattern|--test-reporter|--reporter|--filter|--grep|-run'
  + '|-skip|--skip|--ignore|--ignore-glob|--deselect|--exclude|--shard'
  + ')$'
);

/**
 * Positional path arguments — the SCOPE the run covered.
 *
 * Distinct from `paths` (concrete test FILES). A directory or package argument
 * (`pytest tests/unit`, `go test ./pkg/foo`) names no file and is not a filter
 * flag, so without this it was indistinguishable from a bare whole-suite run —
 * and one subset run could close open cycles for files it never executed.
 * Empty means the command genuinely covers everything.
 */
function scopePathTokens(argv) {
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--') continue;             // npm's arg separator, not a path
    if (FLAG_WITH_VALUE.test(t)) { i += 1; continue; } // its value is not a path
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
  const none = { isTestRun: false, runner: null, paths: [], scopePaths: [], filtered: false };
  const segments = lex(command);
  if (!segments) return none; // unbalanced quotes — fail open, never guess
  for (const seg of segments) {
    const tokens = stripEnvAssignments(seg.tokens);
    const runner = resolveRunner(tokens);
    if (!runner) continue;
    if (tokens.some((t) => WATCH.test(t))) return none; // no terminal verdict
    // FILTER is tested on the RUNNER's argv, not the raw tokens: `python -m pytest`
    // contains `-m`, and matching that would mark every such run filtered so
    // nothing would ever be recorded.
    const argv = runnerArgv(tokens, runner);
    return {
      isTestRun: true,
      runner,
      paths: testPathTokens(argv),
      scopePaths: scopePathTokens(argv),
      filtered: argv.some((t) => FILTER.test(t)),
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

// Verbs that can rewrite a test file's CONTENT from inside a single command, in
// ways bash-targets.js cannot resolve to a path.
const INLINE_CODE = /^(?:python3?|node|perl|ruby|php)$/;
const INLINE_FLAG = /^-(?:c|e|i)$|^-i\b/;
const RESTORE_VERB = /^(?:checkout|restore|stash)$/;

/**
 * True when a test run shares its command line with something that could have
 * rewritten the test text mid-command.
 *
 * The recorder observes the file before and after the WHOLE command, so a single
 * line that writes weak text, runs it, and restores the original leaves
 * pre == post and is indistinguishable from an honest run. No before/after tap can
 * see inside one command — but the co-tenancy IS visible, and a run whose text
 * provenance cannot be established is not evidence.
 *
 * Narrow deliberately: these combinations are vanishingly rare in honest use, and
 * a false positive costs one unrecorded run, never a blocked command.
 */
function provenanceUnverifiable(command) {
  const segments = lex(command);
  if (!segments) return true; // cannot parse it — do not trust it either
  let sawTestRun = false;
  let sawRewrite = false;
  for (const seg of segments) {
    const tokens = stripEnvAssignments(seg.tokens);
    if (resolveRunner(tokens)) sawTestRun = true;
    const head = baseName(tokens[0] || '');
    if (INLINE_CODE.test(head) && tokens.slice(1).some((t) => INLINE_FLAG.test(t))) sawRewrite = true;
    if (head === 'git' && tokens.slice(1).some((t) => RESTORE_VERB.test(t))) sawRewrite = true;
  }
  return sawTestRun && sawRewrite;
}

module.exports = { parseCommand, provenanceUnverifiable };
