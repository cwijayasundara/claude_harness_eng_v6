#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { computeMetrics } = require('./graph_metrics');

const EDGE_KIND_MAP = {
  imports: 'imports',
  exports: 'imports',
  contains: 'contains',
  inherits: 'inherits',
  implements: 'inherits',
  calls: 'calls',
  subscribes: 'calls',
  publishes: 'calls',
  middleware: 'calls',
  reads_from: 'reads_from',
  writes_to: 'writes_to',
  transforms: 'calls',
  validates: 'calls',
  depends_on: 'imports',
  tested_by: 'tests',
  configures: 'imports',
  related: 'related',
  similar_to: 'related',
};

const LANGUAGE_BY_EXT = {
  '.py': 'python',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.jsx': 'node',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.java': 'java',
  '.cs': 'csharp',
  '.go': 'go',
};

const PREFIX_BY_LANGUAGE = {
  python: 'py',
  node: 'js',
  typescript: 'ts',
  java: 'java',
  csharp: 'cs',
  go: 'go',
  unknown: 'file',
};

function parseArgs(argv) {
  const args = {
    in: '.understand-anything/knowledge-graph.json',
    out: 'specs/brownfield/code-graph.json',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    'Usage: import_understand_graph.js ' +
    '[--in .understand-anything/knowledge-graph.json] ' +
    '[--out specs/brownfield/code-graph.json]\n'
  );
}

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function inferPath(node) {
  if (!node || typeof node !== 'object') return null;
  const raw = node.filePath || node.path || node.relativePath;
  if (raw) return normalizePath(raw);
  if (node.type === 'file' && typeof node.id === 'string') {
    return normalizePath(node.id.replace(/^file:/, ''));
  }
  return null;
}

function inferLanguage(filePath, node) {
  if (node.language) return normalizeLanguage(node.language);
  if (node.languageId) return normalizeLanguage(node.languageId);
  const tags = Array.isArray(node.tags) ? node.tags : [];
  for (const tag of tags) {
    const lang = normalizeLanguage(tag);
    if (lang !== 'unknown') return lang;
  }
  const ext = path.extname(filePath || '').toLowerCase();
  return LANGUAGE_BY_EXT[ext] || 'unknown';
}

function normalizeLanguage(lang) {
  const raw = String(lang || '').toLowerCase();
  if (raw === 'js' || raw === 'javascript' || raw === 'node') return 'node';
  if (raw === 'ts' || raw === 'typescript' || raw === 'tsx') return 'typescript';
  if (raw === 'py' || raw === 'python') return 'python';
  if (raw === 'cs' || raw === 'c#' || raw === 'csharp') return 'csharp';
  if (raw === 'golang' || raw === 'go') return 'go';
  if (raw === 'java') return 'java';
  return 'unknown';
}

function nodeId(language, filePath) {
  return `${PREFIX_BY_LANGUAGE[language] || 'file'}:${filePath}`;
}

function isSymbolNode(node) {
  return ['function', 'class', 'method', 'module', 'interface', 'type'].includes(node.type);
}

function makeEvidence(edge, sourcePath, targetPath) {
  const label = edge.type || 'related';
  const desc = edge.description ? ` ${edge.description}` : '';
  return `${sourcePath || edge.source} -> ${targetPath || edge.target} ${label}${desc}`.trim();
}

function ensureFileNode(filePath, sourceNode, fileNodes) {
  const normalized = normalizePath(filePath);
  if (!normalized) return null;
  if (fileNodes.has(normalized)) return fileNodes.get(normalized);
  const language = inferLanguage(normalized, sourceNode || {});
  const n = { id: nodeId(language, normalized), kind: 'file', language, path: normalized, symbols: [] };
  fileNodes.set(normalized, n);
  return n;
}

function collectFileNodes(graph, ctx) {
  for (const node of graph.nodes) {
    const filePath = inferPath(node);
    if (!filePath) {
      ctx.warnings.push(`node ${node.id || node.name || '<unknown>'}: missing filePath`);
      continue;
    }
    const fileNode = ensureFileNode(filePath, node, ctx.fileNodes);
    if (!fileNode) continue;
    ctx.understandToHarness.set(node.id, fileNode.id);
    if (isSymbolNode(node) && node.name) fileNode.symbols.push(node.name);
  }
  for (const n of ctx.fileNodes.values()) n.symbols = [...new Set(n.symbols)].sort();
}

function resolveTarget(edge, understandToHarness) {
  const target = understandToHarness.get(edge.target);
  if (target) return target;
  return typeof edge.target === 'string' && edge.target.startsWith('ext:')
    ? edge.target
    : `ext:${edge.target || 'unknown'}`;
}

function buildEdges(graph, understandToHarness, fileNodes, warnings) {
  const edges = [];
  const seen = new Set();
  const nodeById = new Map();
  for (const n of fileNodes.values()) nodeById.set(n.id, n);
  for (const edge of graph.edges || []) {
    const source = understandToHarness.get(edge.source);
    if (!source) {
      warnings.push(`edge ${edge.source} -> ${edge.target}: source not mapped`);
      continue;
    }
    const target = resolveTarget(edge, understandToHarness);
    if (source === target) continue;
    const kind = EDGE_KIND_MAP[edge.type] || edge.type || 'related';
    const key = `${source}|${target}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = makeEvidence(edge, (nodeById.get(source) || {}).path, (nodeById.get(target) || {}).path);
    edges.push({ source, target, kind, evidence });
  }
  return edges;
}

function buildMeta(graph, nodes, warnings, inputPath) {
  const languages = {};
  for (const n of nodes) languages[n.language] = (languages[n.language] || 0) + 1;
  return {
    producer: 'understand-anything',
    languages,
    warnings,
    generated_at: new Date().toISOString(),
    source: path.resolve(inputPath),
    understand_anything: {
      version: graph.version || null,
      project: (graph.project && graph.project.name) || null,
      node_count: graph.nodes.length,
      edge_count: Array.isArray(graph.edges) ? graph.edges.length : 0,
    },
  };
}

function buildHarnessGraph(understandGraph, inputPath) {
  if (!understandGraph || !Array.isArray(understandGraph.nodes)) {
    throw new Error('Understand-Anything graph must contain nodes[]');
  }
  const ctx = { fileNodes: new Map(), understandToHarness: new Map(), warnings: [] };
  collectFileNodes(understandGraph, ctx);
  const nodes = [...ctx.fileNodes.values()].sort((a, b) => a.path.localeCompare(b.path));
  const edges = buildEdges(understandGraph, ctx.understandToHarness, ctx.fileNodes, ctx.warnings);
  return {
    nodes,
    edges,
    metrics: computeMetrics(nodes, edges),
    meta: buildMeta(understandGraph, nodes, ctx.warnings, inputPath),
  };
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(fs.readFileSync(args.in, 'utf8'));
  const graph = buildHarnessGraph(raw, args.in);
  ensureDir(args.out);
  fs.writeFileSync(args.out, JSON.stringify(graph, null, 2));
  const metaPath = path.join(
    path.dirname(args.out),
    path.basename(args.out, path.extname(args.out)) + '.meta.json'
  );
  fs.writeFileSync(metaPath, JSON.stringify(graph.meta, null, 2));
  process.stderr.write(
    `Wrote ${args.out} from Understand-Anything ` +
    `(${graph.nodes.length} file nodes, ${graph.metrics.edges} internal edges)\n`
  );
}

if (require.main === module) main();

module.exports = { buildHarnessGraph, normalizeLanguage, inferPath };
