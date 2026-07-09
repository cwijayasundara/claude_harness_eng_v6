'use strict';

// Gap G30 real git-hook integration. Mirrors
// test/pre-commit-git-hook-legacy-discipline.test.js's fixture shape: a
// fixture project must install the sensor scripts explicitly (makeGitProject
// does not copy .claude/scripts), but DOES copy the full .claude/hooks/lib
// tree, so sprout-classify.js / sprout-symbol-check.js / diff-hunks.js /
// legacy-discipline-relatedness.js are already present.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const THREE_SYMBOL_GRAPH = {
  files: [{
    path: 'src/legacy.py',
    symbols: [
      { name: 'f', start: 1, end: 5 },
      { name: 'g', start: 20, end: 25 },
      { name: 'h', start: 40, end: 45 },
    ],
  }],
};
const BODY = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n';

function commitSeed(projectDir) {
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir });
}

function installScripts(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['legacy-discipline-gate.js', 'sprout-diff-gate.js', 'ownership-check.js']) {
    fs.copyFileSync(path.join(__dirname, '..', '.claude', 'scripts', name), path.join(dir, name));
  }
}

function writeGraph(projectDir, graph) {
  const p = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(graph));
}

function writeReceipts(projectDir, rows) {
  const p = path.join(projectDir, 'specs', 'reviews', 'coverage-verdicts.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// Stages the legacy file, seeds a commit, then edits the given 0-indexed
// line numbers (each on its own hunk far enough apart not to merge).
function stageLegacyEdit(projectDir, editIndexes) {
  stage(projectDir, 'src/legacy.py', BODY);
  commitSeed(projectDir);
  const lines = BODY.split('\n');
  for (const i of editIndexes) lines[i] = `${lines[i]} CHANGED`;
  stage(projectDir, 'src/legacy.py', lines.join('\n'));
}

function uncoveredReceipt() {
  return { path: 'src/legacy.py', symbol: '1#f', start: 1, end: 5, verdict: 'UNCOVERED', tests: [], recordedAt: '2026-01-01T00:00:00Z' };
}

test('sprout-diff: no UNCOVERED-evidence candidate -> silent no-op (nothing sprout-shaped)', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, THREE_SYMBOL_GRAPH);
  writeReceipts(projectDir, [
    { path: 'src/legacy.py', symbol: '1#f', start: 1, end: 5, verdict: 'COVERED', tests: ['t'], recordedAt: '2026-01-01T00:00:00Z' },
  ]);
  stageLegacyEdit(projectDir, [2]);
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('sprout-diff-one-symbol'), result.stdout);
});

test('sprout-diff: UNCOVERED evidence but pin-down shape (no new prod file) -> passes, not our concern', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, THREE_SYMBOL_GRAPH);
  writeReceipts(projectDir, [uncoveredReceipt()]);
  stageLegacyEdit(projectDir, [2, 21, 41]); // 3 symbols touched, but no new prod file staged
  stage(projectDir, 'tests/test_legacy.py', 'def test_f(): assert True\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('sprout-diff: sprout-shaped, one-symbol touch -> passes cleanly', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, THREE_SYMBOL_GRAPH);
  writeReceipts(projectDir, [uncoveredReceipt()]);
  stageLegacyEdit(projectDir, [2]); // inside f's 1-5 range only
  stage(projectDir, 'tests/test_legacy.py', 'def test_f(): assert True\n');
  stage(projectDir, 'src/new_unit.py', 'def new_thing():\n    return 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('sprout-diff: sprout-shaped, three-symbol touch -> BLOCKS naming the symbols', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, THREE_SYMBOL_GRAPH);
  writeReceipts(projectDir, [uncoveredReceipt()]);
  stageLegacyEdit(projectDir, [2, 21, 41]); // f, g, h all touched
  stage(projectDir, 'tests/test_legacy.py', 'def test_f(): assert True\n');
  stage(projectDir, 'src/new_unit.py', 'def new_thing():\n    return 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('sprout-diff-one-symbol'), result.stdout);
  assert.ok(result.stdout.includes('src/legacy.py'), result.stdout);
  assert.ok(result.stdout.includes('f, g, h'), result.stdout);
});

test('sprout-diff: two-symbol touch (assumed wrap-rename pair) -> passes with a note', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, THREE_SYMBOL_GRAPH);
  writeReceipts(projectDir, [uncoveredReceipt()]);
  stageLegacyEdit(projectDir, [2, 21]); // f and g only
  stage(projectDir, 'tests/test_legacy.py', 'def test_f(): assert True\n');
  stage(projectDir, 'src/new_unit.py', 'def new_thing():\n    return 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('assumed wrap-rename pair'), result.stdout);
});

test('sprout-diff: HARNESS_SPROUT_DIFF_GATE=off skips loudly even on a violating diff', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, THREE_SYMBOL_GRAPH);
  writeReceipts(projectDir, [uncoveredReceipt()]);
  stageLegacyEdit(projectDir, [2, 21, 41]);
  stage(projectDir, 'tests/test_legacy.py', 'def test_f(): assert True\n');
  stage(projectDir, 'src/new_unit.py', 'def new_thing():\n    return 1\n');
  const result = await runGitHook(projectDir, HOOK, {
    HARNESS_COVERAGE_GATE: 'off',
    HARNESS_SPROUT_DIFF_GATE: 'off',
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED') && result.stdout.includes('sprout-diff'), result.stdout);
});

test('sprout-diff: a regex-fallback graph (no per-file symbol records) degrades loudly, does not block', async () => {
  const projectDir = makeGitProject();
  installScripts(projectDir);
  writeGraph(projectDir, { files: [] });
  stageLegacyEdit(projectDir, [2, 21, 41]);
  stage(projectDir, 'src/new_unit.py', 'def new_thing():\n    return 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});
