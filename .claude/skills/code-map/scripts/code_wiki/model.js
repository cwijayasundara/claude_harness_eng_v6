'use strict';

// Normalized, deterministic model over code-graph.json — robust across producers
// (AST: edges {from,to,type}; regex: same; SCIP/understand imports: {source,target,kind}).
// Pure stdlib. Everything here is derived from the graph, so it's instant and
// always-current — no LLM, the property that makes the wiki "rock solid".

const fs = require('fs');

function load(graphPath) {
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'));
}

function normEdges(graph) {
  return (graph.edges || []).map((e) => ({
    from: e.from != null ? e.from : e.source,
    to: e.to != null ? e.to : e.target,
    type: e.type || e.kind || 'depends',
    evidence: e.evidence || '',
  })).filter((e) => e.from != null && e.to != null);
}

// Symbols arrive in three shapes: rich AST per-file records (graph.files[]:
// {name,kind,start,end,signature}), regex objects ({name,kind,line}), or bare
// name strings (AST node.symbols / regex-fallback). Normalize all to one shape;
// line is null when the producer gives no position (so citations degrade, not lie).
function normSymbols(rich, raw) {
  const src = (rich && rich.length) ? rich : (raw || []);
  return src.map((s) => (typeof s === 'string')
    ? { name: s, kind: 'symbol', line: null, signature: null }
    : { name: s.name, kind: s.kind || 'symbol', line: s.line != null ? s.line : (s.start != null ? s.start : null), signature: s.signature || null });
}

function normNodes(graph) {
  const fileSyms = new Map((graph.files || []).map((f) => [f.path, f.symbols || []]));
  return (graph.nodes || []).map((n) => ({
    id: n.id != null ? n.id : n.path,
    type: n.type || 'module',
    symbols: normSymbols(n.path != null ? fileSyms.get(n.path) : null, n.symbols),
    imports: n.imports || [],
    exports: n.exports || [],
  })).filter((n) => n.id != null);
}

// Fan-in/out from edges (don't trust per-node fields — they vary by producer).
function fanCounts(nodes, edges) {
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  for (const e of edges) {
    fanOut.set(e.from, (fanOut.get(e.from) || 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);
  }
  return { fanIn, fanOut };
}

// Directory/package key for a node id — the deterministic basis for bounded,
// repo-shaped wiki pages (DeepWiki's cluster planning). Strips a leading
// producer/language prefix (`js:`, `py:`) so `js:src/a/b.js` → `src/a`.
function groupKey(id) {
  let s = String(id);
  const colon = s.indexOf(':');
  const slash = s.indexOf('/');
  if (colon !== -1 && (slash === -1 || colon < slash)) s = s.slice(colon + 1);
  const dir = s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : '(root)';
  return dir || '(root)';
}

// Group modules by directory — always bounded, even when the whole repo is one
// connected component (where weakly-connected-components would collapse to one page).
function clusters(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    const k = groupKey(n.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n.id);
  }
  return [...groups.entries()]
    .map(([key, ids]) => ({ key, ids: ids.sort() }))
    .sort((a, b) => b.ids.length - a.ids.length || a.key.localeCompare(b.key));
}

function hubs(nodes, fanIn, fanOut, limit = 10) {
  return nodes
    .map((n) => ({ id: n.id, fanIn: fanIn.get(n.id) || 0, fanOut: fanOut.get(n.id) || 0 }))
    .filter((h) => h.fanIn + h.fanOut > 0)
    .sort((a, b) => b.fanIn - a.fanIn || b.fanOut - a.fanOut || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function entrypoints(nodes, fanIn) {
  return nodes.map((n) => n.id).filter((id) => (fanIn.get(id) || 0) === 0).sort();
}

function build(graph) {
  const nodes = normNodes(graph);
  const edges = normEdges(graph);
  const { fanIn, fanOut } = fanCounts(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes, edges, byId, fanIn, fanOut,
    clusters: clusters(nodes),
    hubs: hubs(nodes, fanIn, fanOut),
    entrypoints: entrypoints(nodes, fanIn),
    cycles: graph.cycles || (graph.metrics && graph.metrics.cycles) || [],
    externalDeps: graph.external_deps || (graph.metrics && graph.metrics.external_deps) || [],
    producer: graph.producer || (graph.meta && graph.meta.producer) || 'unknown',
    language: graph.language || (graph.meta && graph.meta.language) || '',
  };
}

module.exports = { load, normEdges, normNodes, normSymbols, fanCounts, clusters, groupKey, hubs, entrypoints, build };
