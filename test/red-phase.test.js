'use strict';

// Gap G41: red-phase record. Nothing in the harness proved a test ever FAILED
// before the code that satisfies it was written — `tdd-test-first` checks test
// EXISTENCE only (its own comment says "pair with tdd-guard for red-green
// ordering"). A test written to match code already written passes that gate, so
// tautological tests (catalogue #11) are undetected.
//
// This file covers the pure classification half only: is this Bash command a
// test run, what did it say, and which test files does it name. Ledger IO lives
// in the same lib but is exercised by red-phase-ledger.test.js; the PostToolUse
// plumbing lives in hooks/red-phase-record.js (same lib/hook split that
// test-deletion-gate.js and cycle-gate.js use).
//
// KEY SEMANTIC under test: a run is only usable as a red-phase anchor when we
// can distinguish a genuine failure from a broken environment. `pytest` exiting
// non-zero because pytest is not installed is NOT a red phase, and recording it
// as one would arm a lock against a test that never ran.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseCommand,
  parseVerdict,
  failingTestFiles,
  classifyRun,
} = require('../.claude/hooks/lib/red-phase');
const { provenanceUnverifiable } = require('../.claude/hooks/lib/red-phase-command');

// ---------------------------------------------------------------- parseCommand

test('parseCommand recognises the common test runners', () => {
  const cases = [
    ['pytest tests/test_foo.py', 'pytest'],
    ['uv run pytest', 'pytest'],
    ['python -m pytest tests/', 'pytest'],
    ['npx vitest run', 'vitest'],
    ['npx jest src/', 'jest'],
    ['node --test test/foo.test.js', 'node-test'],
    ['go test ./...', 'go-test'],
    ['npm test', 'npm-test'],
    ['npm run test', 'npm-test'],
    ['pnpm test', 'npm-test'],
    ['yarn test', 'npm-test'],
  ];
  for (const [cmd, runner] of cases) {
    const got = parseCommand(cmd);
    assert.strictEqual(got.isTestRun, true, `${cmd} should be a test run`);
    assert.strictEqual(got.runner, runner, `${cmd} runner`);
  }
});

test('parseCommand does not fire on commands that merely mention "test"', () => {
  const cases = [
    'git commit -m "add test for parser"',
    'ls test/',
    'grep -rn test src/',
    'echo "run the test suite"',
    'cat test/foo.test.js',
  ];
  for (const cmd of cases) {
    assert.strictEqual(parseCommand(cmd).isTestRun, false, `${cmd} must not be a test run`);
  }
});

test('parseCommand ignores watch mode — a watch run has no terminal verdict', () => {
  assert.strictEqual(parseCommand('npx vitest --watch').isTestRun, false);
  assert.strictEqual(parseCommand('npm test -- --watch').isTestRun, false);
  assert.strictEqual(parseCommand('npx jest --watchAll').isTestRun, false);
});

// The pin-down lane (skills/pinning-down-behavior Step 4) deliberately flips
// production code and watches the pins fail, via the mutation-smoke wrapper. The
// wrapper spawns the test command itself as a CHILD process, so PostToolUse only
// ever sees the wrapper — but a caller could still name it explicitly, and a
// wrapper invocation must never be mistaken for a first-party test run.
test('parseCommand does not classify harness wrapper scripts as test runs', () => {
  const cases = [
    'node .claude/scripts/mutation-smoke.js --files src/a.py --test-cmd "pytest tests/"',
    'node .claude/scripts/mutation-gate.js --staged',
  ];
  for (const cmd of cases) {
    assert.strictEqual(parseCommand(cmd).isTestRun, false, `${cmd} must not be a test run`);
  }
});

test('parseCommand extracts explicitly named test paths from the command', () => {
  assert.deepStrictEqual(
    parseCommand('pytest tests/test_foo.py tests/test_bar.py -v').paths,
    ['tests/test_foo.py', 'tests/test_bar.py']
  );
  assert.deepStrictEqual(
    parseCommand('node --test test/red-phase.test.js').paths,
    ['test/red-phase.test.js']
  );
  // Flags and non-test positional args are not paths.
  assert.deepStrictEqual(parseCommand('npm test').paths, []);
});

test('parseCommand is quote-aware — a quoted separator does not split the command', () => {
  const got = parseCommand('pytest -k "auth|login" tests/test_auth.py');
  assert.strictEqual(got.isTestRun, true);
  assert.deepStrictEqual(got.paths, ['tests/test_auth.py']);
});

// ---------------------------------------------------------------- parseVerdict

test('parseVerdict reads a pytest pass and failure', () => {
  assert.strictEqual(parseVerdict('pytest', '===== 12 passed in 0.42s ====='), 'pass');
  assert.strictEqual(
    parseVerdict('pytest', 'FAILED tests/test_foo.py::test_bar - AssertionError\n===== 1 failed, 11 passed ====='),
    'fail'
  );
});

test('parseVerdict reads vitest/jest and node --test results', () => {
  assert.strictEqual(parseVerdict('vitest', 'Test Files  3 passed (3)\nTests  9 passed (9)'), 'pass');
  assert.strictEqual(parseVerdict('vitest', 'FAIL  src/a.test.ts > adds\nTest Files  1 failed (3)'), 'fail');
  assert.strictEqual(parseVerdict('node-test', '# pass 2559\n# fail 0'), 'pass');
  assert.strictEqual(parseVerdict('node-test', '# pass 10\n# fail 2'), 'fail');
});

// This is the trap the whole control turns on. Reuses toolchain.js's
// MISSING_SIGNATURES rather than a second copy — the duplication ratchet would
// bite a copy, and two lists would drift.
test('parseVerdict reports env-broken, not fail, when the runner itself is missing', () => {
  const cases = [
    'bash: pytest: command not found',
    'No module named pytest',
    'error: Failed to spawn: `pytest`',
    'Cannot find module vitest',
    'no tests ran',
  ];
  for (const text of cases) {
    assert.strictEqual(parseVerdict('pytest', text), 'env-broken', `${text} is not a red phase`);
  }
});

test('parseVerdict returns env-broken on empty/unreadable output rather than guessing', () => {
  assert.strictEqual(parseVerdict('pytest', ''), 'env-broken');
  assert.strictEqual(parseVerdict('pytest', null), 'env-broken');
});

// ------------------------------------------------------------ failingTestFiles

test('failingTestFiles extracts pytest FAILED paths, deduped', () => {
  const out = [
    'FAILED tests/test_foo.py::test_a - AssertionError',
    'FAILED tests/test_foo.py::test_b - ValueError',
    'FAILED tests/test_bar.py::test_c - AssertionError',
  ].join('\n');
  assert.deepStrictEqual(failingTestFiles('pytest', out), ['tests/test_bar.py', 'tests/test_foo.py']);
});

test('failingTestFiles extracts vitest/jest FAIL paths', () => {
  const out = 'FAIL  src/a.test.ts > adds\n FAIL  src/b.test.tsx\n';
  assert.deepStrictEqual(failingTestFiles('vitest', out), ['src/a.test.ts', 'src/b.test.tsx']);
});

test('failingTestFiles returns [] when no file is nameable', () => {
  assert.deepStrictEqual(failingTestFiles('npm-test', 'something broke'), []);
});

// ------------------------------------------------------------------ classifyRun

test('classifyRun combines command and output into one record-ready verdict', () => {
  const got = classifyRun({
    command: 'pytest tests/test_foo.py',
    text: 'FAILED tests/test_foo.py::test_a - AssertionError\n===== 1 failed =====',
  });
  assert.strictEqual(got.isTestRun, true);
  assert.strictEqual(got.runner, 'pytest');
  assert.strictEqual(got.verdict, 'fail');
  assert.deepStrictEqual(got.testFiles, ['tests/test_foo.py']);
});

test('classifyRun unions command paths and output-named failing files', () => {
  const got = classifyRun({
    command: 'pytest tests/',
    text: 'FAILED tests/test_foo.py::test_a - AssertionError',
  });
  assert.deepStrictEqual(got.testFiles, ['tests/test_foo.py']);
});

test('classifyRun on a green run still names the files it ran, so green-first is derivable', () => {
  // The lock arms on FIRST-observed-run-red. A green run therefore has to be
  // recorded too, or a characterization (pin-down) test — which is green-first by
  // design (skills/pinning-down-behavior Step 3) — could not be distinguished
  // from a TDD test and would be locked against its own permitted repair.
  const got = classifyRun({
    command: 'pytest tests/test_pin.py',
    text: '===== 3 passed in 0.10s =====',
  });
  assert.strictEqual(got.verdict, 'pass');
  assert.deepStrictEqual(got.testFiles, ['tests/test_pin.py']);
});

test('classifyRun yields isTestRun false for a non-test command', () => {
  const got = classifyRun({ command: 'ls test/', text: 'foo.test.js' });
  assert.strictEqual(got.isTestRun, false);
  assert.strictEqual(got.verdict, null);
});

test('classifyRun never reports fail when the environment was broken', () => {
  const got = classifyRun({ command: 'pytest tests/test_foo.py', text: 'bash: pytest: command not found' });
  assert.strictEqual(got.verdict, 'env-broken');
  assert.deepStrictEqual(got.testFiles, [], 'a run that never happened names no files');
});

// Round-2 review, Important. The verdict is run-level, but it was applied to
// every file the command named: `pytest a b` where only `a` fails recorded BOTH
// as failing, locking a passing test and raising a false G43 block on any later
// legitimate edit of it.
test('a failing multi-file run records only the files the output names as failing', () => {
  const got = classifyRun({
    command: 'pytest tests/a_test.py tests/b_test.py',
    text: 'FAILED tests/a_test.py::t - x\n===== 1 failed, 1 passed =====',
  });
  assert.strictEqual(got.verdict, 'fail');
  assert.deepStrictEqual(got.testFiles, ['tests/a_test.py'], 'b passed and must not be recorded red');
});

test('a single-file failing run still attributes the failure when output names nothing', () => {
  const got = classifyRun({ command: 'pytest tests/only_test.py', text: '===== 1 failed =====' });
  assert.strictEqual(got.verdict, 'fail');
  assert.deepStrictEqual(got.testFiles, ['tests/only_test.py'], 'unambiguous: one file named, it failed');
});

test('a passing run records every file it named', () => {
  const got = classifyRun({
    command: 'pytest tests/a_test.py tests/b_test.py',
    text: '===== 2 passed =====',
  });
  assert.deepStrictEqual(got.testFiles, ['tests/a_test.py', 'tests/b_test.py']);
});

// Round-2 review, Critical. A directory/subset run names no FILES and is not
// `filtered`, so it looked identical to a bare whole-suite sweep — and one
// `pytest tests/unit` closed open cycles for files it never ran.
test('parseCommand reports positional scope paths, so a subset run is not a whole-suite sweep', () => {
  assert.deepStrictEqual(parseCommand('pytest tests/unit').scopePaths, ['tests/unit']);
  assert.deepStrictEqual(parseCommand('pytest tests/a_test.py').scopePaths, ['tests/a_test.py']);
  assert.deepStrictEqual(parseCommand('go test ./pkg/foo').scopePaths, ['./pkg/foo']);
  // A bare whole-suite run genuinely covers everything.
  assert.deepStrictEqual(parseCommand('pytest').scopePaths, []);
  assert.deepStrictEqual(parseCommand('npm test').scopePaths, []);
  // Flags and their values are not scope.
  assert.deepStrictEqual(parseCommand('pytest -q --maxfail 2').scopePaths, []);
});

// Self-review after round 2. jest reports suite-level and test-level failures on
// SEPARATE lines, and the fail signature keyed on `Tests:` never matched
// `Test Suites:`. A suite that failed to compile while other tests passed was
// therefore read as a clean pass — which closes a red->green cycle, releases the
// lock, and makes G43 compare the file against itself.
test('jest: a failed SUITE is a failure even when the tests that ran passed', () => {
  const text = 'Test Suites: 1 failed, 1 passed, 2 total\nTests:       3 passed, 3 total';
  assert.strictEqual(parseVerdict('jest', text), 'fail');
});

test('jest: an all-green run is still a pass', () => {
  const text = 'Test Suites: 2 passed, 2 total\nTests:       9 passed, 9 total';
  assert.strictEqual(parseVerdict('jest', text), 'pass');
});

// The conservative direction is deliberate elsewhere: a runner that could not
// run (collection error, no test files) is env-broken and recorded as nothing,
// never as a pass. Not arming is safe; a false green is not.
test('a runner that could not run is env-broken, never a pass', () => {
  assert.strictEqual(parseVerdict('pytest', '===== 1 error in 0.53s ====='), 'env-broken');
  assert.strictEqual(parseVerdict('vitest', 'No test files found, exiting with code 1'), 'env-broken');
});

// Round-3 review, Critical. Exclusion flags select which tests run just as much
// as inclusion flags do, but were not treated as filters — so
// `pytest tests/unit --ignore=tests/unit/test_a.py` looked like a full green
// sweep of tests/unit and closed test_a's open cycle without ever running it.
test('exclusion flags mark a run as filtered, not as a full sweep', () => {
  const cases = [
    'pytest tests/unit --ignore=tests/unit/test_a.py',
    'pytest tests/unit --ignore tests/unit/test_a.py',
    'pytest tests/unit --deselect tests/unit/test_a.py::t',
    'pytest -m "not slow" tests/unit',
    'npx vitest run --exclude src/a.test.ts',
    'go test ./... -skip TestSlow',
  ];
  for (const cmd of cases) {
    assert.strictEqual(parseCommand(cmd).filtered, true, `${cmd} selects a subset and must be filtered`);
  }
});

test('a genuine full sweep is still not filtered', () => {
  for (const cmd of ['pytest', 'pytest tests/unit', 'npm test', 'go test ./...']) {
    assert.strictEqual(parseCommand(cmd).filtered, false, `${cmd} must remain a full sweep`);
  }
});

// Round-3 review, Critical — the part the pre-run snapshot CANNOT close.
//
// The recorder sees the file before and after the whole Bash command, so a single
// line that writes weak test text, runs it, and restores the original leaves
// pre == post and is indistinguishable from an honest run:
//
//   python -c "open('t.py','w').write(WEAK)" ; pytest t.py ; git checkout t.py
//
// No before/after tap can see inside one command. What IS detectable is the
// co-tenancy: a test run sharing a command line with an inline-code interpreter or
// a content-restoring git verb has unverifiable text provenance, so the run is not
// usable as evidence. Narrow on purpose — these combinations are vanishingly rare
// in honest use, and the cost of a false positive is one unrecorded run.
test('a test run sharing a command with inline interpreter code is unverifiable', () => {
  const cases = [
    'python -c "open(\'tests/t.py\',\'w\').write(x)" ; pytest tests/t.py',
    'pytest tests/t.py && node -e "require(\'fs\').writeFileSync(\'tests/t.py\',y)"',
    'perl -i -pe s/3/0/ tests/t.py; pytest tests/t.py',
    'pytest tests/t.py ; git checkout tests/t.py',
    'pytest tests/t.py; git restore tests/t.py',
    'git stash pop && pytest tests/t.py',
  ];
  for (const cmd of cases) {
    assert.strictEqual(provenanceUnverifiable(cmd), true, `should be unverifiable: ${cmd}`);
  }
});

test('an ordinary test run is verifiable', () => {
  const cases = [
    'pytest tests/t.py',
    'npm test',
    'pytest tests/t.py -v --maxfail 1',
    'cd backend && pytest',
    'git status && pytest',                 // reading git is fine
    'python -m pytest tests/t.py',          // -m is a module, not inline code
  ];
  for (const cmd of cases) {
    assert.strictEqual(provenanceUnverifiable(cmd), false, `should be verifiable: ${cmd}`);
  }
});
