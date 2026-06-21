#!/usr/bin/env node
'use strict';

// Import a SCIP index into the harness code-graph schema. SCIP is the precise
// code-intelligence format the sourcegraph scip-* indexers emit (scip-python,
// scip-typescript, scip-java, scip-go, …) — strong on large and polyglot repos
// where the vendored AST producer is weak. Consume `scip print --json index.scip`
// (camelCase JSON), NOT the protobuf or a live sourcegraph backend, so this stays
// deterministic and offline like the other producers. Mirrors the
// understand-anything adapter: file-node granularity, internal edges only.

const fs = require('fs');
const path = require('path');
const { computeMetrics } = require('./graph_metrics');
const { normalizeLanguage } = require('./import_understand_graph');

// SCIP SymbolRole bitset (scip.proto). We only need definition vs import.
const ROLE_DEFINITION = 0x1;
const ROLE_IMPORT = 0x2;

const PREFIX_BY_LANGUAGE = {
  python: 'py', node: 'js', typescript: 'ts', java: 'java', csharp: 'cs', go: 'go', unknown: 'file',
};

const isDefinition = (roles) => ((roles || 0) & ROLE_DEFINITION) !== 0;
const isImport = (roles) => ((roles || 0) & ROLE_IMPORT) !== 0;
const isLocal = (symbol) => typeof symbol !== 'string' || symbol.startsWith('local ');
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const langPrefix = (lang) => PREFIX_BY_LANGUAGE[lang] || 'file';
const nodeId = (lang, p) => `${langPrefix(lang)}:${p}`;

// Best-effort human name: SCIP gives displayName directly; otherwise take the
// last descriptor of the symbol moniker, stripping its trailing suffix char.
function displayNameOf(si) {
  if (si.displayName) return si.displayName;
  const descriptors = String(si.symbol || '').split(/\s+/).pop() || '';
  const last = descriptors.split(/[/#.]/).filter(Boolean).pop() || '';
  return last.replace(/[().#]+$/, '');
}

// Map every locally-defined symbol -> its defining file (relativePath). Drawn
// from Definition-role occurrences and the document's own SymbolInformation set.
function buildSymbolIndex(documents) {
  const symToFile = new Map();
  for (const doc of documents) {
    const file = normPath(doc.relativePath);
    for (const occ of doc.occurrences || []) {
      if (isDefinition(occ.symbolRoles) && !isLocal(occ.symbol)) symToFile.set(occ.symbol, file);
    }
    for (const si of doc.symbols || []) {
      if (!isLocal(si.symbol) && !symToFile.has(si.symbol)) symToFile.set(si.symbol, file);
    }
  }
  return symToFile;
}

function collectNodes(documents) {
  const fileNodes = new Map();
  const langByPath = new Map();
  for (const doc of documents) {
    const file = normPath(doc.relativePath);
    if (!file) continue;
    const language = normalizeLanguage(doc.language);
    langByPath.set(file, language);
    const node = fileNodes.get(file) || { id: nodeId(language, file), kind: 'file', language, path: file, symbols: [] };
    for (const si of doc.symbols || []) {
      if (isLocal(si.symbol)) continue;
      const name = displayNameOf(si);
      if (name) node.symbols.push(name);
    }
    fileNodes.set(file, node);
  }
  for (const n of fileNodes.values()) n.symbols = [...new Set(n.symbols)].sort();
  return { fileNodes, langByPath };
}

function addEdge(edges, seen, source, target, kind, srcPath, tgtPath) {
  if (source === target) return;
  const key = `${source}|${target}|${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ source, target, kind, evidence: `${srcPath} -> ${tgtPath} ${kind}` });
}

function referenceEdges(documents, symToFile, langByPath, edges, seen) {
  for (const doc of documents) {
    const srcFile = normPath(doc.relativePath);
    for (const occ of doc.occurrences || []) {
      if (isDefinition(occ.symbolRoles) || isLocal(occ.symbol)) continue;
      const defFile = symToFile.get(occ.symbol);
      if (!defFile || defFile === srcFile) continue; // unresolved (external) or same-file
      const kind = isImport(occ.symbolRoles) ? 'imports' : 'calls';
      addEdge(edges, seen, nodeId(langByPath.get(srcFile), srcFile),
        nodeId(langByPath.get(defFile), defFile), kind, srcFile, defFile);
    }
  }
}

function relationshipEdges(documents, symToFile, langByPath, edges, seen) {
  for (const doc of documents) {
    for (const si of doc.symbols || []) {
      const srcFile = symToFile.get(si.symbol);
      if (!srcFile) continue;
      for (const rel of si.relationships || []) {
        if (!rel.isImplementation) continue;
        const tgtFile = symToFile.get(rel.symbol);
        if (!tgtFile || tgtFile === srcFile) continue;
        addEdge(edges, seen, nodeId(langByPath.get(srcFile), srcFile),
          nodeId(langByPath.get(tgtFile), tgtFile), 'inherits', srcFile, tgtFile);
      }
    }
  }
}

function buildScipGraph(scip, inputPath) {
  const documents = (scip && scip.documents) || [];
  if (!Array.isArray(documents)) throw new Error('SCIP index must contain documents[]');
  const symToFile = buildSymbolIndex(documents);
  const { fileNodes, langByPath } = collectNodes(documents);
  const edges = [];
  const seen = new Set();
  referenceEdges(documents, symToFile, langByPath, edges, seen);
  relationshipEdges(documents, symToFile, langByPath, edges, seen);
  const nodes = [...fileNodes.values()].sort((a, b) => a.path.localeCompare(b.path));
  const languages = {};
  for (const n of nodes) languages[n.language] = (languages[n.language] || 0) + 1;
  return {
    nodes,
    edges: edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
    metrics: computeMetrics(nodes, edges),
    meta: {
      producer: 'scip',
      languages,
      warnings: [],
      generated_at: new Date().toISOString(),
      source: path.resolve(inputPath),
      scip: { document_count: documents.length, symbol_count: symToFile.size },
    },
  };
}

function parseArgs(argv) {
  const args = { in: 'index.scip.json', out: 'specs/brownfield/code-graph.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stderr.write('Usage: import_scip_graph.js [--in index.scip.json] [--out specs/brownfield/code-graph.json]\n');
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = buildScipGraph(JSON.parse(fs.readFileSync(args.in, 'utf8')), args.in);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(graph, null, 2));
  const metaPath = path.join(path.dirname(args.out), path.basename(args.out, path.extname(args.out)) + '.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(graph.meta, null, 2));
  process.stderr.write(`Wrote ${args.out} from SCIP (${graph.nodes.length} file nodes, ${graph.metrics.edges} internal edges)\n`);
}

if (require.main === module) main();

module.exports = { buildScipGraph, displayNameOf, buildSymbolIndex };
