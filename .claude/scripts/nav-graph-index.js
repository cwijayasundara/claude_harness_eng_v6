#!/usr/bin/env node

'use strict';

// Inverted indexes over code-graph.json for O(1) symbol/path lookup without
// re-scanning the full graph text in hot paths. Pure JSON (no native SQLite).
// Path: .claude/state/nav-graph-index.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_REL = path.join('.claude', 'state', 'nav-graph-index.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function fingerprint(graph) {
  const meta = (graph && graph.meta) || {};
  return crypto.createHash('sha256')
    .update(String(meta.generated_at || ''))
    .update(`:${(graph.files || []).length}:${(graph.edges || []).length}`)
    .digest('hex')
    .slice(0, 16);
}

function buildGraphIndex({ projectDir = process.cwd() } = {}) {
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const graph = readJson(graphPath);
  if (!graph || ((graph.files || []).length === 0 && (graph.nodes || []).length === 0)) {
    return { ok: false, reason: 'missing_or_empty_graph' };
  }

  const bySymbol = {}; // lower name -> [{path, start, end, symbol, kind}]
  const byPath = {}; // path -> symbols[]
  const callers = {}; // path -> [paths that depend on it]
  const callees = {}; // path -> [paths it depends on]

  for (const f of graph.files || []) {
    const syms = [];
    for (const s of f.symbols || []) {
      const rec = {
        path: f.path,
        start: s.start || s.line || 1,
        end: s.end || s.start || s.line || 1,
        symbol: s.name || null,
        kind: s.kind || 'symbol',
        signature: s.signature || null,
      };
      syms.push(rec);
      if (s.name) {
        const k = String(s.name).toLowerCase();
        if (!bySymbol[k]) bySymbol[k] = [];
        bySymbol[k].push(rec);
      }
    }
    byPath[f.path] = syms;
  }

  function pathOf(id) {
    const s = String(id || '');
    const i = s.indexOf(':');
    return i === -1 ? s : s.slice(i + 1);
  }

  for (const e of graph.edges || []) {
    const from = pathOf(e.source != null ? e.source : e.from);
    const to = pathOf(e.target != null ? e.target : e.to);
    if (!from || !to) continue;
    if (!callers[to]) callers[to] = [];
    if (!callees[from]) callees[from] = [];
    if (!callers[to].includes(from)) callers[to].push(from);
    if (!callees[from].includes(to)) callees[from].push(to);
  }

  const index = {
    schema_version: 1,
    built_at: new Date().toISOString(),
    fingerprint: fingerprint(graph),
    symbol_count: Object.keys(bySymbol).length,
    path_count: Object.keys(byPath).length,
    by_symbol: bySymbol,
    by_path: byPath,
    callers,
    callees,
  };

  const out = path.join(projectDir, OUT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(index)}\n`);
  return { ok: true, path: out, symbol_count: index.symbol_count, path_count: index.path_count };
}

function loadGraphIndex(projectDir) {
  return readJson(path.join(projectDir, OUT_REL));
}

function lookupSymbol(projectDir, name) {
  const idx = loadGraphIndex(projectDir);
  if (!idx || !idx.by_symbol) return [];
  return idx.by_symbol[String(name || '').toLowerCase()] || [];
}

function lookupCallers(projectDir, filePath) {
  const idx = loadGraphIndex(projectDir);
  if (!idx || !idx.callers) return [];
  return idx.callers[filePath] || [];
}

module.exports = {
  buildGraphIndex,
  loadGraphIndex,
  lookupSymbol,
  lookupCallers,
  OUT_REL,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const result = buildGraphIndex({ projectDir });
  if (!result.ok) {
    process.stderr.write(`nav-graph-index: ${result.reason}\n`);
    process.exit(0);
  }
  process.stdout.write(`nav-graph-index: ${result.symbol_count} symbols, ${result.path_count} paths → ${result.path}\n`);
}
