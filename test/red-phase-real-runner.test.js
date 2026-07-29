'use strict';

// G41 classifier, against REAL runner output.
//
// WHY THIS FILE EXISTS: the first version of red-phase.test.js asserted against
// output written BY HAND — `'# pass 10\n# fail 2'` — which is TAP, and not what
// `node --test` actually prints. Node >=22 defaults to the `spec` reporter even
// non-TTY, emitting `ℹ fail 1`. Every unit test passed while the classifier
// returned env-broken for both pass and fail, so nothing was ever recorded and
// the whole G41-G43 chain was inert for this repo's own runner.
//
// That is the exact failure this branch exists to prevent, and it shipped inside
// it: I invented the oracle, then tested against the invention. CLAUDE.md #5 says
// round-trip the REAL artifact through its REAL validator. The other round-trip
// test does that for git and the ledger; this one does it for the runner.
//
// So: no hand-written runner output below. Every string is captured from an
// actual process.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { classifyRun } = require('../.claude/hooks/lib/red-phase');

const PASSING = "const {test}=require('node:test');const a=require('node:assert');\ntest('adds', () => { a.strictEqual(1, 1); });\n";
const FAILING = "const {test}=require('node:test');const a=require('node:assert');\ntest('adds', () => { a.strictEqual(1, 2); });\n";

function probeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-real-'));
  fs.writeFileSync(path.join(dir, 'ok.test.js'), PASSING);
  fs.writeFileSync(path.join(dir, 'bad.test.js'), FAILING);
  return dir;
}

// Run the real runner and return exactly what it printed.
//
// NODE_TEST_CONTEXT must be cleared: node:test detects a recursive `--test`
// invocation from inside a test process and skips running files entirely, which
// would leave us asserting against an empty string — a green test proving
// nothing, which is the whole failure class this file exists to close.
function realRun(dir, args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env });
  const text = `${res.stdout || ''}${res.stderr || ''}`;
  assert.match(text, /^[ℹ#]\s*tests\s+\d+/im, `the probe runner produced no test output:\n${text}`);
  return text;
}

test('a REAL passing `node --test` run classifies as pass', () => {
  const dir = probeDir();
  const text = realRun(dir, ['--test', 'ok.test.js']);
  const got = classifyRun({ command: 'node --test ok.test.js', text });
  assert.strictEqual(got.verdict, 'pass', `classified ${got.verdict} from real output:\n${text}`);
  assert.deepStrictEqual(got.testFiles, ['ok.test.js']);
});

test('a REAL failing `node --test` run classifies as fail', () => {
  const dir = probeDir();
  const text = realRun(dir, ['--test', 'bad.test.js']);
  const got = classifyRun({ command: 'node --test bad.test.js', text });
  assert.strictEqual(got.verdict, 'fail', `classified ${got.verdict} from real output:\n${text}`);
});

// Guards the regression directly: the spec reporter prints `ℹ fail N`, the TAP
// reporter prints `# fail N`. Both are real, both must be understood.
test('both the spec and TAP reporters are understood', () => {
  const dir = probeDir();
  const spec = realRun(dir, ['--test', 'bad.test.js']);
  const tap = realRun(dir, ['--test', '--test-reporter=tap', 'bad.test.js']);
  assert.match(spec, /ℹ\s*fail\s+1/, 'expected the spec reporter shape');
  assert.match(tap, /#\s*fail\s+1/, 'expected the TAP reporter shape');
  for (const [name, text] of [['spec', spec], ['tap', tap]]) {
    assert.strictEqual(
      classifyRun({ command: 'node --test bad.test.js', text }).verdict,
      'fail',
      `${name} reporter misread`
    );
  }
});

// C2: red -> filtered "pass" -> the cycle closes, the lock releases, and G43's
// pair compares the file against itself. One flag, whole chain bypassed.
//
// Counting executed tests does NOT close this, and the real runner is why: node
// reports `tests 1 / pass 1` even for `--test-name-pattern=nothing-matches-this`
// AND for a file containing no tests at all, because it counts the file itself.
// This assertion is recorded so nobody "fixes" the count parser and believes the
// bypass is handled.
test('node counts cannot detect a zero-test run — so counts must not carry C2', () => {
  const dir = probeDir();
  fs.writeFileSync(path.join(dir, 'empty.test.js'), '// no tests here\n');
  const noMatch = realRun(dir, ['--test', '--test-name-pattern=nothing-matches-this', 'ok.test.js']);
  const noTests = realRun(dir, ['--test', 'empty.test.js']);
  assert.match(noMatch, /^ℹ\s*pass\s+1/im, 'node reports a pass for a pattern matching nothing');
  assert.match(noTests, /^ℹ\s*pass\s+1/im, 'node reports a pass for a file with no tests');
});

// What actually carries C2: the run is marked non-authoritative because the AGENT
// chose which tests executed, so "green" says nothing about the failing one.
test('a REAL filtered run is marked non-authoritative', () => {
  const dir = probeDir();
  for (const args of [
    ['--test', '--test-name-pattern=adds', 'ok.test.js'],
    ['--test', '--test-name-pattern=nothing-matches-this', 'ok.test.js'],
  ]) {
    const text = realRun(dir, args);
    const got = classifyRun({ command: `node ${args.join(' ')}`, text });
    assert.strictEqual(got.filtered, true, `not marked filtered: node ${args.join(' ')}`);
  }
  // ...and an unfiltered run is not, or nothing would ever be recorded.
  const plain = realRun(dir, ['--test', 'ok.test.js']);
  assert.strictEqual(classifyRun({ command: 'node --test ok.test.js', text: plain }).filtered, false);
});

test('a REAL missing-runner invocation is env-broken, not fail', () => {
  const dir = probeDir();
  const res = spawnSync('pytest-definitely-not-installed', ['tests/'], { cwd: dir, encoding: 'utf8' });
  const text = res.error ? `${res.error.code}: pytest-definitely-not-installed` : `${res.stdout}${res.stderr}`;
  const got = classifyRun({ command: 'pytest-definitely-not-installed tests/', text });
  assert.notStrictEqual(got.verdict, 'fail', 'an absent runner is not a red phase');
});
