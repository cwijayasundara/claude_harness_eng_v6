#!/usr/bin/env node

'use strict';

// Stop/SubagentStop — drain .claude/state/graph-dirty.jsonl and patch
// specs/brownfield/code-graph.json via the AST indexer's --files mode, then
// re-render symbol-map.md. Keeps the brownfield graph fresh after every edit
// without per-edit cost: verify-on-save only appends to the dirty list
// (microseconds); the sub-second re-parse happens once per turn here.
// Fails open: missing python3/wheels or a non-AST graph never blocks the stop.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');
const { stampDerived } = require('./lib/stale-stamp');

const LOCK_TTL_MS = 60000;

function readDirty(dirtyFile, projectDir) {
  let raw;
  try {
    raw = fs.readFileSync(dirtyFile, 'utf8');
  } catch (_) {
    return [];
  }
  const rels = new Set();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rel = JSON.parse(line).file;
      if (rel && fs.existsSync(path.join(projectDir, rel))) rels.add(rel);
    } catch (_) { /* skip malformed lines */ }
  }
  return [...rels];
}

function holdLock(stateDir) {
  const lock = path.join(stateDir, 'graph-refresh.lock');
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age < LOCK_TTL_MS) return null;
  } catch (_) { /* no lock */ }
  fs.writeFileSync(lock, String(process.pid));
  return lock;
}

function refresh(projectDir, rels) {
  const indexer = path.join(
    projectDir, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py'
  );
  const graph = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  if (!fs.existsSync(indexer)) return false;
  const patch = spawnSync('python3', [
    indexer, '--root', projectDir, '--out', graph,
    '--skeleton-dir', path.join(projectDir, 'specs', 'brownfield', 'skeletons'),
    '--files', ...rels,
  ], { encoding: 'utf8', timeout: 25000 });
  if (patch.status !== 0) return false;
  spawnSync('python3', [
    indexer, '--render-map', graph,
    '--out', path.join(projectDir, 'specs', 'brownfield', 'symbol-map.md'),
  ], { encoding: 'utf8', timeout: 25000 });
  // Re-render the deterministic wiki off the freshly-patched graph so it stays
  // current with zero LLM cost (fails open — wiki render never blocks the stop,
  // but a persistent failure is surfaced so a stale wiki is not silent).
  const wiki = spawnSync('node', [
    path.join(projectDir, '.claude', 'skills', 'code-map', 'scripts', 'code_wiki.js'),
    'render', '--graph', graph, '--out', path.join(projectDir, 'specs', 'brownfield', 'wiki'),
  ], { encoding: 'utf8', timeout: 25000 });
  if (wiki.status !== 0) process.stderr.write(`graph-refresh: wiki render failed: ${(wiki.stderr || '').trim()}\n`);
  return true;
}

function producerIsAst(projectDir) {
  try {
    const meta = JSON.parse(fs.readFileSync(
      path.join(projectDir, 'specs', 'brownfield', 'code-graph.meta.json'), 'utf8'
    ));
    return meta.producer === 'vendored-ast';
  } catch (_) {
    return false;
  }
}

function producerIsPlaceholder(projectDir) {
  try {
    const meta = JSON.parse(fs.readFileSync(
      path.join(projectDir, 'specs', 'brownfield', 'code-graph.meta.json'), 'utf8'
    ));
    return meta.producer === 'none' && meta.status === 'empty';
  } catch (_) {
    return false;
  }
}

function main() {
  readHookInput();
  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const stateDir = path.join(projectDir, '.claude', 'state');
  const dirtyFile = path.join(stateDir, 'graph-dirty.jsonl');
  const rels = readDirty(dirtyFile, projectDir);
  if (rels.length === 0) return;
  if (producerIsPlaceholder(projectDir)) {
    const { refreshNavigation } = require('../scripts/navigation-refresh');
    const status = refreshNavigation({ projectDir, mode: 'first-source' });
    if (status.status === 'fresh') fs.writeFileSync(dirtyFile, '');
    return;
  }
  if (!producerIsAst(projectDir)) {
    fs.writeFileSync(dirtyFile, '');
    return;
  }
  // Meta can outlive a deleted graph — without the graph there is nothing to
  // patch, and --files mode would fail forever while the dirty list grows.
  if (!fs.existsSync(path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'))) {
    fs.writeFileSync(dirtyFile, '');
    return;
  }
  const lock = holdLock(stateDir);
  if (!lock) return;
  try {
    if (refresh(projectDir, rels)) {
      fs.writeFileSync(dirtyFile, '');
      stampDerived(projectDir, rels);
    }
  } finally {
    try { fs.unlinkSync(lock); } catch (_) { /* already gone */ }
  }
}

try {
  main();
} catch (err) {
  reportFailure('graph-refresh', err);
}

process.exit(0);
