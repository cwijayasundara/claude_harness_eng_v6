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

function renderSymbolMap(indexer, graph, projectDir) {
  spawnSync('python3', [
    indexer, '--render-map', graph,
    '--out', path.join(projectDir, 'specs', 'brownfield', 'symbol-map.md'),
  ], { encoding: 'utf8', timeout: 25000 });
}

// dependency-graph.md + coupling-report.md are derived purely from the graph
// JSON (~25ms each, no source scan), so rebuild them fresh off the just-patched
// graph every turn like symbol-map.md. That keeps the STALE banner — and the
// Documentation/Navigation readiness pillar it demotes — off in normal
// operation. stampDerived() is now a genuine-failure fallback: if build_graph.js
// is missing or a render exits non-zero, a real STALE banner still warns
// planners instead of silently shipping outdated coupling data.
function renderDerivedDocs(projectDir, graph, rels) {
  const buildGraph = path.join(
    projectDir, '.claude', 'skills', 'code-map', 'scripts', 'build_graph.js'
  );
  let ok = fs.existsSync(buildGraph);
  if (ok) {
    for (const [flag, out] of [
      ['--render-mermaid', 'dependency-graph.md'],
      ['--coupling-report', 'coupling-report.md'],
    ]) {
      const r = spawnSync('node', [
        buildGraph, flag, graph,
        '--out', path.join(projectDir, 'specs', 'brownfield', out),
      ], { encoding: 'utf8', timeout: 25000 });
      if (r.status !== 0) {
        ok = false;
        process.stderr.write(`graph-refresh: ${out} render failed: ${(r.stderr || '').trim()}\n`);
      }
    }
  }
  if (!ok) stampDerived(projectDir, rels);
}

// Re-render the deterministic wiki off the freshly-patched graph so it stays
// current with zero LLM cost (fails open — wiki render never blocks the stop,
// but a persistent failure is surfaced so a stale wiki is not silent).
function renderWiki(projectDir, graph) {
  const wiki = spawnSync('node', [
    path.join(projectDir, '.claude', 'skills', 'code-map', 'scripts', 'code_wiki.js'),
    'render', '--graph', graph, '--out', path.join(projectDir, 'specs', 'brownfield', 'wiki'),
  ], { encoding: 'utf8', timeout: 25000 });
  if (wiki.status !== 0) process.stderr.write(`graph-refresh: wiki render failed: ${(wiki.stderr || '').trim()}\n`);
}

// Regenerate the interactive single-file graph explorer off the freshly-patched
// graph. Committed like the wiki (see .gitignore exception), so it ships current;
// fails open — a render error never blocks the stop.
function renderExplorer(projectDir, graph) {
  const viewer = path.join(projectDir, '.claude', 'skills', 'code-map', 'scripts', 'graph_viewer.js');
  if (!fs.existsSync(viewer)) return;
  const r = spawnSync('node', [
    viewer, '--in', graph,
    '--out', path.join(projectDir, 'specs', 'brownfield', 'graph-explorer.html'),
    '--repo', path.basename(projectDir),
  ], { encoding: 'utf8', timeout: 25000 });
  if (r.status !== 0) process.stderr.write(`graph-refresh: explorer render failed: ${(r.stderr || '').trim()}\n`);
}

// Fail-open secondary nav artifacts: TF-IDF index, co-change, concept pages
function runNavScripts(projectDir) {
  const navScripts = [
    path.join(projectDir, '.claude', 'scripts', 'nav-index.js'),
    path.join(projectDir, '.claude', 'scripts', 'nav-graph-index.js'),
    path.join(projectDir, '.claude', 'scripts', 'nav-cochange.js'),
    path.join(projectDir, '.claude', 'scripts', 'nav-concepts.js'),
    path.join(projectDir, '.claude', 'scripts', 'nav-brownfield-maps.js'),
    path.join(projectDir, '.claude', 'scripts', 'human-codebase.js'),
  ];
  for (const script of navScripts) {
    if (!fs.existsSync(script)) continue;
    const r = spawnSync('node', [script, '--root', projectDir], {
      encoding: 'utf8',
      timeout: 45000,
    });
    if (r.status !== 0) {
      process.stderr.write(`graph-refresh: ${path.basename(script)} failed: ${(r.stderr || '').trim()}\n`);
    }
  }
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
  renderSymbolMap(indexer, graph, projectDir);
  renderDerivedDocs(projectDir, graph, rels);
  renderWiki(projectDir, graph);
  renderExplorer(projectDir, graph);
  runNavScripts(projectDir);
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

function bootstrapPlaceholder(projectDir, dirtyFile) {
  const { refreshNavigation } = require('../scripts/navigation-refresh');
  const status = refreshNavigation({ projectDir, mode: 'first-source' });
  if (status.status === 'fresh') fs.writeFileSync(dirtyFile, '');
}

function refreshUnderLock(projectDir, stateDir, dirtyFile, rels) {
  const lock = holdLock(stateDir);
  if (!lock) return;
  try {
    if (refresh(projectDir, rels)) fs.writeFileSync(dirtyFile, '');
  } finally {
    try { fs.unlinkSync(lock); } catch (_) { /* already gone */ }
  }
}

function main() {
  const input = readHookInput();
  // SubagentStop fires once per teammate during an agent-team turn. Draining +
  // re-indexing the graph on each is the dominant per-turn cost and is pure
  // waste: graph-dirty.jsonl is append-only and persists, so the top-level Stop
  // coalesces every teammate's edits into a single refresh. Defer here.
  if (input && input.hook_event_name === 'SubagentStop') return;
  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const stateDir = path.join(projectDir, '.claude', 'state');
  const dirtyFile = path.join(stateDir, 'graph-dirty.jsonl');
  const rels = readDirty(dirtyFile, projectDir);
  if (rels.length === 0) return;
  if (producerIsPlaceholder(projectDir)) {
    bootstrapPlaceholder(projectDir, dirtyFile);
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
  refreshUnderLock(projectDir, stateDir, dirtyFile, rels);
}

try {
  main();
} catch (err) {
  reportFailure('graph-refresh', err);
}

process.exit(0);
