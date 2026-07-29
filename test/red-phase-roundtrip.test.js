'use strict';

// G41-G43 round-trip. CLAUDE.md principle #5: integration tests must round-trip
// the REAL artifact through its REAL validator, never hand-built fixtures. A
// fixture encoding the wrong record shape would keep every unit test green while
// the lock sat inert — which is precisely how a gate ships reading a flat
// contract when real contracts nest.
//
// So this drives the actual hook binaries over their actual stdin contract, into
// a real git repo, and reads the real ledger the recorder wrote. Nothing here
// constructs a ledger event by hand.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const RECORDER = path.join(REPO, '.claude', 'hooks', 'red-phase-record.js');
const PRE_WRITE = path.join(REPO, '.claude', 'hooks', 'pre-write-gate.js');
const PRE_BASH = path.join(REPO, '.claude', 'hooks', 'pre-bash-gate.js');

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-roundtrip-'));
  execFileSync('git', ['init', '-q', '.'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'calc.py'), 'def add(a, b):\n    return 0\n');
  fs.writeFileSync(path.join(root, 'tests', 'test_calc.py'), 'def test_add():\n    assert add(1, 2) == 3\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

// Drive a hook exactly as Claude Code does: JSON on stdin, project dir in env.
function runHook(hookPath, root, payload) {
  return spawnSync('node', [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HARNESS_TEST_LOCK: '', HARNESS_TDD_GATE: 'off' },
    cwd: root,
  });
}

function observeRun(root, command, stdout) {
  return runHook(RECORDER, root, {
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout },
  });
}

const RED_OUTPUT = 'FAILED tests/test_calc.py::test_add - assert 0 == 3\n===== 1 failed =====';
const GREEN_OUTPUT = '===== 1 passed in 0.01s =====';

function readLedgerRaw(root) {
  const file = path.join(root, '.claude', 'state', 'red-phase.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('the recorder writes a real ledger event for a real failing run', () => {
  const root = fixtureRepo();
  const res = observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);
  assert.strictEqual(res.status, 0, res.stderr);

  const events = readLedgerRaw(root);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].verdict, 'fail');
  assert.deepStrictEqual(events[0].test_files, ['tests/test_calc.py']);
  assert.match(events[0].file_hashes['tests/test_calc.py'], /^[0-9a-f]{64}$/);
  assert.match(events[0].head_sha, /^[0-9a-f]{40}$/);
});

test('pre-write-gate BLOCKS an Edit to the failing test, and allows the production file', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);

  const blocked = runHook(PRE_WRITE, root, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(root, 'tests', 'test_calc.py'),
      content: 'def test_add():\n    assert add(1, 2) == 0\n', // weakened to match the bug
    },
  });
  assert.strictEqual(blocked.status, 2, 'expected a block (exit 2)');
  assert.match(`${blocked.stdout}${blocked.stderr}`, /production code/i);

  const allowed = runHook(PRE_WRITE, root, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(root, 'src', 'calc.py'),
      content: 'def add(a, b):\n    return a + b\n',
    },
  });
  assert.strictEqual(allowed.status, 0, `production edit must be allowed: ${allowed.stderr}`);
});

// The half that makes the lock real rather than theatre. The source's adversarial
// checklist is explicit that hooks must match shell verbs as well as edit tools.
test('pre-bash-gate BLOCKS the same tamper via sed -i', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);

  const res = runHook(PRE_BASH, root, {
    tool_name: 'Bash',
    tool_input: { command: "sed -i '' 's/== 3/== 0/' tests/test_calc.py" },
  });
  assert.strictEqual(res.status, 2, `sed -i on a locked test must block: ${res.stdout}${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /production code/i);
});

test('the lock releases once the test legitimately goes green', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);
  // Production code fixed; the same unchanged test now passes.
  fs.writeFileSync(path.join(root, 'src', 'calc.py'), 'def add(a, b):\n    return a + b\n');
  observeRun(root, 'pytest tests/test_calc.py', GREEN_OUTPUT);

  const res = runHook(PRE_WRITE, root, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(root, 'tests', 'test_calc.py'),
      content: 'def test_add():\n    assert add(1, 2) == 3\n\ndef test_add_zero():\n    assert add(0, 0) == 0\n',
    },
  });
  assert.strictEqual(res.status, 0, `adding the next test must be allowed: ${res.stdout}${res.stderr}`);
});

// The commit-time backstop, over a ledger the recorder actually wrote.
test('test-integrity passes a clean red->green cycle and BLOCKS a weakened one', () => {
  const clean = fixtureRepo();
  observeRun(clean, 'pytest tests/test_calc.py', RED_OUTPUT);
  fs.writeFileSync(path.join(clean, 'src', 'calc.py'), 'def add(a, b):\n    return a + b\n');
  observeRun(clean, 'pytest tests/test_calc.py', GREEN_OUTPUT);

  const { integrityFindings } = require('../.claude/hooks/lib/test-integrity');
  const { readLedger } = require('../.claude/hooks/lib/red-phase-ledger');
  assert.deepStrictEqual(integrityFindings(readLedger(clean).events), []);

  // Now the tamper: the TEST changes between red and green, production does not.
  const dirty = fixtureRepo();
  observeRun(dirty, 'pytest tests/test_calc.py', RED_OUTPUT);
  fs.writeFileSync(path.join(dirty, 'tests', 'test_calc.py'), 'def test_add():\n    assert add(1, 2) == 0\n');
  observeRun(dirty, 'pytest tests/test_calc.py', GREEN_OUTPUT);

  const findings = integrityFindings(readLedger(dirty).events);
  assert.strictEqual(findings.length, 1, 'the weakened test must be caught');
  assert.strictEqual(findings[0].kind, 'test-changed-between-red-and-green');
  assert.strictEqual(findings[0].file, 'tests/test_calc.py');
});

// The ledger IS the control. An agent that can rewrite or blank it can unlock
// every test, so it belongs to the same protected-machinery class as its direct
// peer .claude/state/task-lifecycle.jsonl — which was already listed while this
// file was not.
test('the red-phase ledger is protected machinery, like task-lifecycle.jsonl', () => {
  const { machineryViolation } = require('../.claude/hooks/lib/trust-boundary');
  const root = REPO;
  const protectedPaths = [
    path.join(root, '.claude', 'state', 'red-phase.jsonl'),
    path.join(root, '.claude', 'state', 'task-lifecycle.jsonl'), // the precedent
  ];
  for (const p of protectedPaths) {
    assert.ok(machineryViolation(root, p), `${p} must be protected machinery`);
  }
  // Ordinary state is still writable — this must not over-reach into a blanket
  // .claude/state/ lock, which would break every gate that ratchets a baseline.
  assert.strictEqual(machineryViolation(root, path.join(root, '.claude', 'state', 'current-lane')), null);
});

// Found by independent review, not by the suite: checkTarget resolves symlinks,
// so on macOS the SAME file reached pre-write-gate as /var/... (blocked) and
// /private/var/... (allowed). Both hooks must relativise against the REAL project
// dir, and both path forms must behave identically.
test('an equivalent path form cannot bypass either hook', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);
  const real = fs.realpathSync(root);
  assert.notStrictEqual(real, root, 'probe needs a symlinked tmp dir to be meaningful');

  for (const base of [root, real]) {
    const write = runHook(PRE_WRITE, root, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(base, 'tests', 'test_calc.py'), content: 'def test_add():\n    pass\n' },
    });
    assert.strictEqual(write.status, 2, `pre-write-gate allowed the ${base === root ? '/var' : '/private/var'} form`);

    const bash = runHook(PRE_BASH, root, {
      tool_name: 'Bash',
      tool_input: { command: `sed -i '' 's/3/0/' ${path.join(base, 'tests', 'test_calc.py')}` },
    });
    assert.strictEqual(bash.status, 2, `pre-bash-gate allowed the ${base === root ? '/var' : '/private/var'} form`);
  }
});

// C2 end-to-end: the cheapest bypass of the whole chain.
test('a filtered run cannot release the lock', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);
  // The agent runs a filter that matches nothing and exits 0.
  observeRun(root, 'pytest tests/test_calc.py -k nothing-matches', '===== 0 passed, 1 deselected in 0.01s =====');

  const res = runHook(PRE_WRITE, root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'tests', 'test_calc.py'), content: 'def test_add():\n    pass\n' },
  });
  assert.strictEqual(res.status, 2, 'a filtered green must not close the cycle');
});

// B2: an unfiltered whole-suite green names no files, but still proves the
// previously-failing file passes — otherwise the lock could never be released.
test('an unfiltered green sweep that names no files closes the open cycle', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', RED_OUTPUT);
  fs.writeFileSync(path.join(root, 'src', 'calc.py'), 'def add(a, b):\n    return a + b\n');
  observeRun(root, 'pytest', GREEN_OUTPUT); // bare run: no FAILED lines, no paths

  const res = runHook(PRE_WRITE, root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'tests', 'test_calc.py'), content: 'def test_add():\n    assert add(1, 2) == 3\n\ndef test_zero():\n    assert add(0, 0) == 0\n' },
  });
  assert.strictEqual(res.status, 0, `the sweep should have closed the cycle: ${res.stdout}${res.stderr}`);
});

test('an env-broken run never arms the lock', () => {
  const root = fixtureRepo();
  observeRun(root, 'pytest tests/test_calc.py', 'bash: pytest: command not found');
  assert.deepStrictEqual(readLedgerRaw(root), [], 'nothing should have been recorded');

  const res = runHook(PRE_WRITE, root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'tests', 'test_calc.py'), content: 'def test_add():\n    pass\n' },
  });
  assert.strictEqual(res.status, 0, 'a test that never ran must not be locked');
});
