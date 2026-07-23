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

// withCoverageTooling controls whether the project could POSSIBLY produce coverage.
// It is declared explicitly rather than inferred, so the block-vs-note decision does
// not depend on whether the machine running the suite happens to have python3
// `coverage` importable.
function makeBrownfieldProject({ withCoverage = true, withCoverageTooling = true } = {}) {
  const projectDir = makeHookProject([HOOK]);
  const srcPath = path.join(projectDir, 'src', 'svc.js');
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, SRC);
  if (withCoverageTooling) {
    installCoverageMapScript(projectDir);
    // A declared devDependency is enough for the tooling probe — no install needed.
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { nyc: '^15.0.0' } }, null, 2)
    );
  }
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

test('blocks when the file is graph-mapped, coverage is absent, but tooling could produce it', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject({ withCoverage: false });
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 1;'), ENV);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(/coverage/i.test(result.stdout), result.stdout);
  assert.ok(result.stdout.includes('--cov'), result.stdout);
});

// A block the developer cannot satisfy is an unsatisfiable wall, not a gate. This is
// the case that made the gate fire on this very repo: no nyc/c8/vitest/jest, tests run
// under `node --test`, so no command exists that would produce coverage-final.json.
test('degrades to a note when no coverage data exists AND no tooling could produce it', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject({ withCoverage: false, withCoverageTooling: false });
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 1;'), ENV);
  assert.strictEqual(result.status, 0, `must not block: ${result.stdout}`);
});

// The tooling probe must match the edited file's language. This repo has coverage.py
// importable and ships coverage_map.py, but tests JS under `node --test` — so python
// tooling must not be read as "can cover this .js file". Asserted on the pure function
// so it does not depend on what the machine has installed.
test('python coverage tooling does not count as coverage tooling for a .js file', () => {
  const { canProduceCoverage } = require('../.claude/hooks/lib/coverage-preflight.js');
  const projectDir = makeHookProject([HOOK]);
  installCoverageMapScript(projectDir); // python side present
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'fixture' }));
  assert.strictEqual(canProduceCoverage(projectDir, 'src/svc.js'), false,
    'a .js file needs a JS coverage runner; coverage.py cannot produce it');
});

test('a JS runner does not count as coverage tooling for a .py file', () => {
  const { canProduceCoverage } = require('../.claude/hooks/lib/coverage-preflight.js');
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: { nyc: '^15.0.0' } })
  );
  assert.strictEqual(canProduceCoverage(projectDir, 'src/svc.py'), false,
    'a .py file needs coverage.py; nyc cannot produce it');
});

test('the degraded note is loud — it names the gap and stays on the UNCOVERED side', async () => {
  const { projectDir, srcPath } = makeBrownfieldProject({ withCoverage: false, withCoverageTooling: false });
  const result = await runHook(projectDir, HOOK, editInput(srcPath, '  return 1;'), ENV);
  const out = result.stdout + result.stderr;
  assert.match(out, /coverage preflight cannot run/i, 'must say it could not run, not stay silent');
  assert.match(out, /UNCOVERED/, 'must keep treating the symbols as uncovered');
  assert.match(out, /nyc|c8|vitest|jest/, 'must name what it looked for, so the gap is actionable');
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
