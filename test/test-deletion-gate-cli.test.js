'use strict';

// Gap G31 CLI/orchestration layer: dependency-injected `exec` so git plumbing
// is exercised without spawning real git (same DI shape legacy-discipline-
// gate.js's tests use for its own `exec`).

const { test } = require('node:test');
const assert = require('node:assert');
const { collectStagedChanges, checkStaged, run } = require('../.claude/scripts/test-deletion-gate');

function fakeExec(map) {
  return (cmd, args) => {
    const key = args.join(' ');
    if (key in map) {
      const v = map[key];
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error(`unstubbed git call: ${cmd} ${key}`);
  };
}

test('collectStagedChanges builds old/new content for modified and deleted test files only', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=M': 'a.test.js\nsrc/prod.js\n',
    'diff --cached --name-only --diff-filter=D': 'b.test.js\n',
    'show HEAD:a.test.js': "it('a', () => {});\nit('b', () => {});\n",
    'show :a.test.js': "it('a', () => {});\n",
    'show HEAD:b.test.js': "it('c', () => {});\n",
  });
  const changes = collectStagedChanges(exec);
  assert.deepStrictEqual(changes, [
    { file: 'a.test.js', oldContent: "it('a', () => {});\nit('b', () => {});\n", newContent: "it('a', () => {});\n" },
    { file: 'b.test.js', oldContent: "it('c', () => {});\n", newContent: null },
  ]);
});

test('checkStaged passes when no test files were modified or deleted', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=M': 'src/prod.js\n',
    'diff --cached --name-only --diff-filter=D': '',
  });
  const verdict = checkStaged(exec);
  assert.deepStrictEqual(verdict, { pass: true, findings: [] });
});

test('checkStaged fails and reports a finding when a test file was deleted', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=M': '',
    'diff --cached --name-only --diff-filter=D': 'gone.test.js\n',
    'show HEAD:gone.test.js': "it('a', () => {});\n",
  });
  const verdict = checkStaged(exec);
  assert.strictEqual(verdict.pass, false);
  assert.strictEqual(verdict.findings.length, 1);
  assert.strictEqual(verdict.findings[0].kind, 'deleted');
});

test('run() requires --staged and exits 2 on bad usage', () => {
  const status = run([], process.cwd(), { exec: fakeExec({}) });
  assert.strictEqual(status, 2);
});

test('run() returns 0 on a clean staged set, 1 when a finding exists', () => {
  const clean = run(['--staged'], process.cwd(), {
    exec: fakeExec({
      'diff --cached --name-only --diff-filter=M': '',
      'diff --cached --name-only --diff-filter=D': '',
    }),
  });
  assert.strictEqual(clean, 0);

  const dirty = run(['--staged'], process.cwd(), {
    exec: fakeExec({
      'diff --cached --name-only --diff-filter=M': '',
      'diff --cached --name-only --diff-filter=D': 'gone.test.js\n',
      'show HEAD:gone.test.js': "it('a', () => {});\n",
    }),
  });
  assert.strictEqual(dirty, 1);
});
