#!/usr/bin/env node
'use strict';

// Import a Graphify (github.com/Graphify-Labs/graphify) graph.json into the
// harness code-graph schema. Graphify is a bring-your-own producer, like SCIP
// and Understand-Anything: never installed or invoked by this harness, only
// imported if a team already runs it and commits graphify-out/graph.json.
// Consume graph.json only (NetworkX node_link_data format: {nodes, links}),
// never invoke the `graphify` CLI or its MCP server, so this stays offline
// and deterministic. Mirrors the SCIP adapter: file-node granularity,
// internal edges only, unresolved/external symbols intentionally dropped.
//
// Graphify emits both file nodes and symbol nodes (functions/classes/
// methods) in one flat nodes[] array, tagged file_type: "code" | "rationale"
// (LLM-derived commit-message narrative) | absent (external/unresolved —
// stdlib and third-party symbols with no source_file). Only "code" nodes
// with a source_file become part of the harness graph; "rationale" nodes
// and unresolved externals are dropped like SCIP's ext: symbols.
//
// Of Graphify's relation kinds, only imports / imports_from / calls /
// inherits map cleanly onto the harness edge vocabulary. contains and
// method are intra-file structure (not coupling facts), rationale_for
// links code to LLM-derived narrative nodes, and uses is a 100%-INFERRED
// fuzzy reference relation with no harness equivalent — all four are
// dropped rather than guessed at, matching the "does not invent edges"
// policy the other import adapters already follow. Confidence
// (EXTRACTED/INFERRED) is preserved in each edge's evidence string since
// the harness edge shape has no confidence field of its own.

const fs = require('fs');
const path = require('path');
const { computeMetrics } = require('./graph_metrics');

const RELATION_KIND_MAP = {
  imports: 'imports',
  imports_from: 'imports',
  calls: 'calls',
  inherits: 'inherits',
};

const LANGUAGE_BY_EXT = {
  '.py': 'python',
  '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.jsx': 'node',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.java': 'java', '.cs': 'csharp', '.go': 'go',
};

const PREFIX_BY_LANGUAGE = {
  python: 'py', node: 'js', typescript: 'ts', java: 'java', csharp: 'cs', go: 'go', unknown: 'file',
};

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function languageOf(filePath) {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] || 'unknown';
}

function nodeId(language, filePath) {
  return `${PREFIX_BY_LANGUAGE[language] || 'file'}:${filePath}`;
}

// Every graphify "code" node (file or symbol) carries the source_file it was
// extracted from. Group them by file to build one harness file node per
// path, collecting non-file-self labels as that file's symbols.
function collectFileNodes(nodes, warnings) {
  const byPath = new Map();
  const symbolToPath = new Map();
  for (const n of nodes) {
    if (n.file_type !== 'code' || !n.source_file) continue;
    const filePath = normPath(n.source_file);
    const language = languageOf(filePath);
    if (language === 'unknown') {
      warnings.push(`${filePath}: unrecognized extension, skipped`);
      continue;
    }
    symbolToPath.set(n.id, filePath);
    let file = byPath.get(filePath);
    if (!file) {
      file = { id: nodeId(language, filePath), kind: 'file', language, path: filePath, symbols: new Set() };
      byPath.set(filePath, file);
    }
    const label = n.label || n.id;
    if (label && label !== path.basename(filePath)) file.symbols.add(label);
  }
  const nodes_ = [...byPath.values()]
    .map((f) => ({ ...f, symbols: [...f.symbols].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { nodes: nodes_, symbolToPath };
}

function buildEdges(links, symbolToPath, fileNodeById) {
  const edges = [];
  const seen = new Set();
  for (const link of links || []) {
    const kind = RELATION_KIND_MAP[link.relation];
    if (!kind) continue;
    const srcPath = symbolToPath.get(link.source);
    const tgtPath = symbolToPath.get(link.target);
    if (!srcPath || !tgtPath) continue; // external / rationale / unresolved
    if (srcPath === tgtPath) continue;
    const source = fileNodeById.get(nodeId(languageOf(srcPath), srcPath));
    const target = fileNodeById.get(nodeId(languageOf(tgtPath), tgtPath));
    if (!source || !target) continue;
    const key = `${source.id}|${target.id}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = link.source_location ? `:${link.source_location.replace(/^L/, '')}` : '';
    const confidence = link.confidence ? ` [${link.confidence}]` : '';
    edges.push({
      source: source.id,
      target: target.id,
      kind,
      evidence: `${srcPath}${loc} ${kind} ${tgtPath}${confidence}`,
    });
  }
  return edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
}

function buildGraphifyGraph(graphify, inputPath) {
  if (!graphify || !Array.isArray(graphify.nodes)) {
    throw new Error('Graphify graph.json must contain nodes[]');
  }
  const warnings = [];
  const { nodes, symbolToPath } = collectFileNodes(graphify.nodes, warnings);
  const fileNodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = buildEdges(graphify.links, symbolToPath, fileNodeById);
  const languages = {};
  for (const n of nodes) languages[n.language] = (languages[n.language] || 0) + 1;
  return {
    nodes,
    edges,
    metrics: computeMetrics(nodes, edges),
    meta: {
      producer: 'graphify',
      languages,
      warnings,
      generated_at: new Date().toISOString(),
      source: path.resolve(inputPath),
      graphify: { node_count: graphify.nodes.length, link_count: (graphify.links || []).length },
    },
  };
}

function parseArgs(argv) {
  const args = { in: 'graphify-out/graph.json', out: 'specs/brownfield/code-graph.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stderr.write('Usage: import_graphify_graph.js [--in graphify-out/graph.json] [--out specs/brownfield/code-graph.json]\n');
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = buildGraphifyGraph(JSON.parse(fs.readFileSync(args.in, 'utf8')), args.in);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(graph, null, 2));
  const metaPath = path.join(path.dirname(args.out), path.basename(args.out, path.extname(args.out)) + '.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(graph.meta, null, 2));
  process.stderr.write(`Wrote ${args.out} from Graphify (${graph.nodes.length} file nodes, ${graph.metrics.edges} internal edges)\n`);
}

if (require.main === module) main();

module.exports = { buildGraphifyGraph, languageOf, normPath };
