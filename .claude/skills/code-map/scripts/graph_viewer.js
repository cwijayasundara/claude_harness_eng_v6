#!/usr/bin/env node
'use strict';

// Render code-graph.json into a single self-contained, dependency-free HTML
// "code-graph explorer": a searchable file index, a canvas ego-network graph
// (importers + imports of the focused node), and an inspector showing symbols,
// callers, and internal/external dependencies. Deterministic — nodes and edges
// are path-sorted so re-renders diff only when the graph actually changes.
// Presentation + browser logic live in graph-viewer-template.html; this file
// only binds the graph data into that template.
//
// Usage: node graph_viewer.js [--in code-graph.json] [--out graph-explorer.html] [--repo label]

const fs = require('fs');
const path = require('path');

const HUB_FANIN = 8;
const MAX_SYMBOLS = 80;
const MAX_EXTERNAL = 60;
const KIND_CODE = { imports: 0, renders: 1, inherits: 2, instantiates: 3, calls: 4, reads_from: 5, writes_to: 6 };
const CODE_KIND = Object.keys(KIND_CODE);
const TEMPLATE = path.join(__dirname, 'graph-viewer-template.html');

const isExternal = (id) => String(id).startsWith('ext:');
const extName = (id) => String(id).replace(/^ext:/, '');
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function parseArgs(argv) {
  const args = { in: 'specs/brownfield/code-graph.json', out: 'specs/brownfield/graph-explorer.html', repo: path.basename(process.cwd()) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
  }
  return args;
}

function sortedFileNodes(graph) {
  return graph.nodes.filter((n) => !isExternal(n.id)).slice()
    .sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function makeSymbols(file) {
  if (!file || !Array.isArray(file.symbols)) return [];
  return file.symbols.slice().sort((a, b) => (a.start || 0) - (b.start || 0)).slice(0, MAX_SYMBOLS)
    .map((s) => ({ n: s.name, g: s.signature || '', s: s.start || 0, e: s.end || 0, k: s.kind || '' }));
}

function makeNode(n, file) {
  const symTotal = file && Array.isArray(file.symbols) ? file.symbols.length : 0;
  return {
    p: n.path, l: n.language || 'unknown', fin: 0, fout: 0, hub: false,
    loc: file ? file.loc || 0 : 0, symOverflow: Math.max(0, symTotal - MAX_SYMBOLS),
    sym: makeSymbols(file), ext: new Set(),
  };
}

function addEdges(graph, indexById, nodes) {
  const edges = [];
  const seen = new Set();
  for (const e of graph.edges) {
    const kindCode = KIND_CODE[e.kind];
    if (kindCode === undefined) continue;
    const si = indexById.get(e.source);
    if (si === undefined) continue;
    if (isExternal(e.target)) { nodes[si].ext.add(extName(e.target)); continue; }
    const ti = indexById.get(e.target);
    if (ti === undefined || ti === si) continue;
    const key = `${si}|${ti}|${kindCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([si, ti, kindCode]);
    nodes[si].fout++; nodes[ti].fin++;
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return edges;
}

function finalizeNode(n) {
  n.hub = n.fin >= HUB_FANIN;
  const extList = [...n.ext].sort();
  n.extOverflow = Math.max(0, extList.length - MAX_EXTERNAL);
  n.ext = extList.slice(0, MAX_EXTERNAL);
}

function computeStats(graph, nodes, edges) {
  const m = graph.metrics || {};
  return {
    files: nodes.length, internalEdges: edges.length,
    externalImports: m.external_imports || nodes.reduce((a, n) => a + n.ext.length + (n.extOverflow || 0), 0),
    cycles: (m.cycles || []).length, hubThreshold: HUB_FANIN,
  };
}

function buildModel(graph, repo) {
  const fileNodes = sortedFileNodes(graph);
  const indexById = new Map(fileNodes.map((n, i) => [n.id, i]));
  const filesByPath = new Map((graph.files || []).map((f) => [f.path, f]));
  const nodes = fileNodes.map((n) => makeNode(n, filesByPath.get(n.path)));
  const edges = addEdges(graph, indexById, nodes);
  nodes.forEach(finalizeNode);
  const languages = {};
  for (const n of nodes) languages[n.l] = (languages[n.l] || 0) + 1;
  return {
    repo, generated_at: (graph.meta && graph.meta.generated_at) || '', producer: (graph.meta && graph.meta.producer) || '',
    kinds: CODE_KIND, stats: computeStats(graph, nodes, edges), languages, nodes, edges,
  };
}

// Function replacements avoid $-pattern interpretation in the injected data.
function render(model, template) {
  const data = JSON.stringify(model).replace(/</g, '\\u003c');
  const title = escapeHtml(`code-graph explorer — ${model.repo}`);
  return template.replace('__TITLE__', () => title).replace('__GRAPH_DATA__', () => data);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = JSON.parse(fs.readFileSync(args.in, 'utf8'));
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const model = buildModel(graph, args.repo);
  const html = render(model, template);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, html);
  process.stderr.write(`Wrote ${args.out} — ${model.stats.files} files, ${model.stats.internalEdges} internal links, ${model.stats.externalImports} external imports (${(html.length / 1024).toFixed(0)} KB)\n`);
}

if (require.main === module) main();
module.exports = { buildModel, render };
