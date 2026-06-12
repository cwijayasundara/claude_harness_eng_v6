'use strict';

// Deterministic enforcement of checking-coverage-before-change's Iron Law:
// on brownfield-mapped projects (code-graph.json present), editing a
// graph-mapped production symbol requires a coverage verdict — UNCOVERED
// symbols block with a route to pin-down/sprout instead of silently editing.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook, REPO_ROOT } = require('./helpers/hook-fixture');

const HOOK = 'pre-write-gate.js';
const ENV = { HARNESS_TDD_GATE: 'off' };

const SRC = [
  'function coveredFn() {',
  '  return 1;',
  '}',
  '',
  'function uncoveredFn() {',
  '  return 2;',
  '}',
  '',
].join('\n');

function writeGraph(projectDir) {
  fs.mkdirSync(path.join(projectDir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({
    meta: { root: projectDir, producer: 'code_index.py' },
    nodes: [{ id: 'n1', path: 'src/svc.js' }],
    files: [{
      path: 'src/svc.js',
      symbols: [
        { name: 'coveredFn', start: 1, end: 3 },
        { name: 'uncoveredFn', start: 5, end: 7 },
      ],
    }],
  }));
}

function writeCoverage(projectDir, srcPath) {
  fs.writeFileSync(path.join(projectDir, 'coverage-final.json'), JSON.stringify({
    [srcPath]: {
      s: { 0: 3 },
      statementMap: { 0: { start: { line: 1 }, end: { line: 3 } } },
    },
  }));
}

function installCoverageMapScript(projectDir) {
  const scriptDir = path.join(projectDir, '.claude', 'skills', 'code-map', 'scripts', 'code_index');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'coverage_map.py'),
    path.join(scriptDir, 'coverage_map.py')
  );
}

function makeBrownfieldProject({ withCoverage = true } = {}) {
  const projectDir = makeHookProject([HOOK]);
  const srcPath = path.join(projectDir, 'src', 'svc.js');
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, SRC);
  installCoverageMapScript(projectDir);
  writeGraph(projectDir);
  if (withCoverage) writeCoverage(projectDir, srcPath);
  return { projectDir, srcPath };
}

function editInput(srcPath, oldString) {
  return { tool_name: 'Edit', tool_input: { file_path: srcPath, old_string: oldString, new_string: 'return 99;' } };
}

test('blocks an edit that touches an UNCOVERED symbol', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject();
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 2;'), ENV);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(result.stdout.includes('uncoveredFn'), result.stdout);
  assert.ok(/pin|sprout/i.test(result.stdout), result.stdout);
});

test('allows an edit confined to a COVERED symbol', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject();
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 1;'), ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('blocks when the file is graph-mapped but no coverage data exists', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject({ withCoverage: false });
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 1;'), ENV);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(/coverage/i.test(result.stdout), result.stdout);
  assert.ok(result.stdout.includes('--cov'), result.stdout);
});

test('inactive without a brownfield code graph', async () => {
  const projectDir = makeHookProject([HOOK]);
  const srcPath = path.join(projectDir, 'src', 'svc.js');
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, SRC);
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 2;'), ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('inactive for files the graph does not map', async () => {
  const { projectDir } = makeBrownfieldProject();
  const otherPath = path.join(projectDir, 'src', 'other.js');
  fs.writeFileSync(otherPath, 'module.exports = 1;\n');
  const result = await runHook(projectDir, HOOK, editInput(otherPath, 'module.exports = 1;'), ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('new-file writes (sprouting) are not gated', async () => {
  const { projectDir } = makeBrownfieldProject();
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'sprouted.js'), content: 'module.exports = 2;\n' },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('test files are not gated', async () => {
  const { projectDir } = makeBrownfieldProject();
  const testPath = path.join(projectDir, 'tests', 'svc.test.js');
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  fs.writeFileSync(testPath, 'test("x", () => {});\n');
  const result = await runHook(projectDir, HOOK, editInput(testPath, 'test("x", () => {});'), ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('a whole-file Write over a mapped file is gated at file level', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject();
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: srcPath, content: 'rewritten\n' },
  }, ENV);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(result.stdout.includes('uncoveredFn'), result.stdout);
});

test('HARNESS_COVERAGE_PREFLIGHT=off disables the preflight', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject();
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 2;'),
    { ...ENV, HARNESS_COVERAGE_PREFLIGHT: 'off' });
  assert.strictEqual(result.status, 0, result.stdout);
});
