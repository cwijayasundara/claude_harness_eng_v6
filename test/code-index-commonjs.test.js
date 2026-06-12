/**
 * Tests for CommonJS require() extraction in ts_index.py.
 * Guards against CommonJS Node codebases producing coupling-blind graphs
 * (0 import edges), which starves seam-finder and brownfield risk maps.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const SCRIPT = path.join(
  repoRoot, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py'
);

const STORAGE_JS = [
  "const { readFileSync } = require('node:fs');",
  '',
  'function readTodos() {',
  '  return [];',
  '}',
  '',
  'module.exports = { readTodos };',
  '',
].join('\n');

const TODO_JS = [
  "const { readTodos } = require('./storage.js');",
  "const storage = require('./storage');",
  '',
  'function list() {',
  '  return readTodos();',
  '}',
  '',
  'module.exports = { list };',
  '',
].join('\n');

function python3Available() {
  return spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
}

function makeCjsProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-cjs-'));
  fs.writeFileSync(path.join(dir, 'storage.js'), STORAGE_JS);
  fs.writeFileSync(path.join(dir, 'todo.js'), TODO_JS);
  return dir;
}

function runIndexer(rootDir) {
  const out = path.join(rootDir, 'code-graph.json');
  const res = spawnSync('python3', [
    SCRIPT, '--root', rootDir, '--out', out,
    '--skeleton-dir', path.join(rootDir, 'skel'), '--skeleton-threshold', '999',
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

test('require() with destructuring resolves to an internal imports edge',
  { skip: !python3Available() },
  () => {
    const graph = runIndexer(makeCjsProject());
    const edge = graph.edges.find(
      (e) => e.source === 'js:todo.js' && e.target === 'js:storage.js' &&
        e.kind === 'imports' && e.evidence === 'todo.js:1 import ./storage.js'
    );
    assert.ok(edge, 'destructured require edge todo.js -> storage.js missing');
  });

test('whole-module require() without extension resolves to an internal imports edge',
  { skip: !python3Available() },
  () => {
    const graph = runIndexer(makeCjsProject());
    const edge = graph.edges.find(
      (e) => e.source === 'js:todo.js' && e.target === 'js:storage.js' &&
        e.kind === 'imports' && e.evidence === 'todo.js:2 import ./storage'
    );
    assert.ok(edge, 'whole-module require edge todo.js -> storage.js missing');
  });

test('external require() produces an ext: edge',
  { skip: !python3Available() },
  () => {
    const graph = runIndexer(makeCjsProject());
    const ext = graph.edges.find(
      (e) => e.source === 'js:storage.js' && e.target === 'ext:node:fs' && e.kind === 'imports'
    );
    assert.ok(ext, 'external require must produce an ext: edge');
  });
