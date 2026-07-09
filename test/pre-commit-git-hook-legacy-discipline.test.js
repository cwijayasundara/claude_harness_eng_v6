'use strict';

// Real git-hook integration for gap G17 (legacy-discipline-proof). Mirrors
// test/pre-commit-git-hook-ownership.test.js: the ownership gate and this one
// share the same "lazy-required sensor script, no-op without its prerequisite
// artifact" shape, so a fixture project must install the script explicitly
// (makeGitProject() does not copy .claude/scripts).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';
const SYMBOL_GRAPH = { files: [{ path: 'src/legacy.py', symbols: [{ name: 'f', start: 1, end: 5 }] }] };

// Commits whatever is currently staged, so the NEXT stage() of the same path
// is a real modification (status M), not an add — the gate exempts adds.
function commitSeed(projectDir) {
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir });
}

function installLegacyDisciplineScripts(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['legacy-discipline-gate.js', 'ownership-check.js']) {
    fs.copyFileSync(
      path.join(__dirname, '..', '.claude', 'scripts', name),
      path.join(dir, name)
    );
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

test('legacy-discipline: silent no-op when no code-graph.json exists', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('legacy-discipline'), result.stdout);
});

test('legacy-discipline: blocks a modified production file with no recorded verdict, naming it', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  // Commit the file first so the next stage is a MODIFICATION, not an add.
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  commitSeed(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('legacy-discipline-proof'), result.stdout);
  assert.ok(result.stdout.includes('src/legacy.py'), result.stdout);
});

test('legacy-discipline: a newly-added file (greenfield) is exempt even with no receipt', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  stage(projectDir, 'src/brand_new.py', 'x = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('legacy-discipline: passes when the modified file has a COVERED receipt', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  writeReceipts(projectDir, [
    { path: 'src/legacy.py', symbol: '1#f', start: 1, end: 5, verdict: 'COVERED', tests: ['t'], recordedAt: '2026-01-01T00:00:00Z' },
  ]);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  commitSeed(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('legacy-discipline: an UNCOVERED receipt with no test staged is blocked', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  writeReceipts(projectDir, [
    { path: 'src/legacy.py', symbol: '1#f', start: 1, end: 5, verdict: 'UNCOVERED', tests: [], recordedAt: '2026-01-01T00:00:00Z' },
  ]);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  commitSeed(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('UNCOVERED, NO TEST STAGED'), result.stdout);
});

test('legacy-discipline: an UNCOVERED receipt WITH a staged pin-down test passes', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  writeReceipts(projectDir, [
    { path: 'src/legacy.py', symbol: '1#f', start: 1, end: 5, verdict: 'UNCOVERED', tests: [], recordedAt: '2026-01-01T00:00:00Z' },
  ]);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  commitSeed(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  stage(projectDir, 'tests/test_legacy.py', 'def test_f(): assert True\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('legacy-discipline: a regex-fallback graph (no per-file symbol records) degrades loudly, does not BLOCK', async () => {
  // Regression for CR-001: the wired pre-commit path once skipped the
  // hasSymbolRecords guard run() applies, so a Java/C#/Go project (regex
  // fallback graph) would BLOCK every legacy edit forever with no way to
  // ever record a receipt (coverage_map.py itself refuses to run against
  // such a graph) — contradicting the documented degrade-loud behavior.
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, { files: [] }); // present, but no per-file symbol records
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  commitSeed(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('legacy-discipline: a renamed AND modified legacy file with no receipt is still blocked', async () => {
  // Regression for CR-002: --diff-filter=M alone misses git's rename
  // detection (status R), letting a rename+edit dodge the receipt
  // requirement entirely.
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  // A larger, mostly-unchanged file so git's similarity heuristic actually
  // detects the rename (tiny files can fall under the default threshold).
  const body = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n';
  stage(projectDir, 'src/legacy.py', body);
  commitSeed(projectDir);
  // git rm (not fs.rmSync) so the deletion is itself staged — rename
  // detection needs BOTH the old path staged-deleted and the new path
  // staged-added in the same diff to pair them into a single R entry.
  execFileSync('git', ['rm', '-q', 'src/legacy.py'], { cwd: projectDir });
  stage(projectDir, 'src/legacy_renamed.py', body + 'line 50\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('src/legacy_renamed.py'), result.stdout);
});

test('legacy-discipline: HARNESS_LEGACY_DISCIPLINE_GATE=off skips loudly', async () => {
  const projectDir = makeGitProject();
  installLegacyDisciplineScripts(projectDir);
  writeGraph(projectDir, SYMBOL_GRAPH);
  stage(projectDir, 'src/legacy.py', 'x = 1\n');
  commitSeed(projectDir);
  stage(projectDir, 'src/legacy.py', 'x = 2\n');
  const result = await runGitHook(projectDir, HOOK, {
    HARNESS_COVERAGE_GATE: 'off',
    HARNESS_LEGACY_DISCIPLINE_GATE: 'off',
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED') && result.stdout.includes('legacy-discipline'), result.stdout);
});
