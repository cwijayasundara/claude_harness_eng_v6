#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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

const EXT_BY_LANGUAGE = {
  python: '.py',
  javascript: '.js',
  typescript: '.ts',
  tsx: '.tsx',
  jsx: '.jsx',
  java: '.java',
  csharp: '.cs',
  go: '.go',
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

function buildHarnessGraph(understandGraph, inputPath) {
  if (!understandGraph || !Array.isArray(understandGraph.nodes)) {
    throw new Error('Understand-Anything graph must contain nodes[]');
  }

  const fileNodes = new Map();
  const understandToHarness = new Map();
  const warnings = [];

  function ensureFileNode(filePath, sourceNode = {}) {
    const normalized = normalizePath(filePath);
    if (!normalized) return null;
    if (fileNodes.has(normalized)) return fileNodes.get(normalized);
    const language = inferLanguage(normalized, sourceNode);
    const n = {
      id: nodeId(language, normalized),
      kind: 'file',
      language,
      path: normalized,
      symbols: [],
    };
    fileNodes.set(normalized, n);
    return n;
  }

  for (const node of understandGraph.nodes) {
    const filePath = inferPath(node);
    if (!filePath) {
      warnings.push(`node ${node.id || node.name || '<unknown>'}: missing filePath`);
      continue;
    }
    const fileNode = ensureFileNode(filePath, node);
    if (!fileNode) continue;
    understandToHarness.set(node.id, fileNode.id);
    if (isSymbolNode(node) && node.name) {
      fileNode.symbols.push(node.name);
    }
  }

  for (const n of fileNodes.values()) {
    n.symbols = [...new Set(n.symbols)].sort();
  }

  const edges = [];
  const seenEdges = new Set();
  // O(1) node lookup by id — avoids an O(n) scan per edge (was O(n·e) on big graphs).
  const nodeById = new Map();
  for (const n of fileNodes.values()) nodeById.set(n.id, n);

  for (const edge of understandGraph.edges || []) {
    const source = understandToHarness.get(edge.source);
    let target = understandToHarness.get(edge.target);
    if (!source) {
      warnings.push(`edge ${edge.source} -> ${edge.target}: source not mapped`);
      continue;
    }
    if (!target) {
      target = typeof edge.target === 'string' && edge.target.startsWith('ext:')
        ? edge.target
        : `ext:${edge.target || 'unknown'}`;
    }
    if (source === target) continue;

    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    const kind = EDGE_KIND_MAP[edge.type] || edge.type || 'related';
    const key = `${source}|${target}|${kind}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({
      source,
      target,
      kind,
      evidence: makeEvidence(edge, sourceNode && sourceNode.path, targetNode && targetNode.path),
    });
  }

  const nodes = [...fileNodes.values()].sort((a, b) => a.path.localeCompare(b.path));
  const metrics = computeMetrics(nodes, edges);
  const languages = {};
  for (const n of nodes) {
    languages[n.language] = (languages[n.language] || 0) + 1;
  }

  return {
    nodes,
    edges,
    metrics,
    meta: {
      producer: 'understand-anything',
      languages,
      warnings,
      generated_at: new Date().toISOString(),
      source: path.resolve(inputPath),
      understand_anything: {
        version: understandGraph.version || null,
        project: understandGraph.project && understandGraph.project.name || null,
        node_count: understandGraph.nodes.length,
        edge_count: Array.isArray(understandGraph.edges) ? understandGraph.edges.length : 0,
      },
    },
  };
}

function instability(fanIn, fanOut) {
  const total = fanIn + fanOut;
  return total === 0 ? 0 : Math.round((fanOut / total) * 1000) / 1000;
}

function computeMetrics(nodes, edges) {
  const byId = new Set(nodes.map((n) => n.id));
  const fanIn = new Map();
  const fanOut = new Map();
  const adj = new Map();
  let internalEdges = 0;
  let externalImports = 0;

  for (const e of edges) {
    if (String(e.target).startsWith('ext:')) {
      externalImports++;
      continue;
    }
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    internalEdges++;
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
    fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    adj.get(e.source).add(e.target);
  }

  const hubs = [];
  for (const id of byId) {
    const fi = fanIn.get(id) || 0;
    const fo = fanOut.get(id) || 0;
    if (fi + fo === 0) continue;
    hubs.push({ id, fan_in: fi, fan_out: fo, instability: instability(fi, fo) });
  }
  hubs.sort((a, b) => (b.fan_in - a.fan_in) || (b.fan_out - a.fan_out));

  return {
    files: nodes.length,
    edges: internalEdges,
    external_imports: externalImports,
    cycles: findCycles(adj),
    hubs: hubs.slice(0, 25),
  };
}

// Iterative Tarjan SCC (explicit work-stack) — stack-safe on large graphs,
// unlike a recursive strongconnect which can overflow Node's call stack.
function tarjanPush(v, st) {
  st.indexOf.set(v, st.index);
  st.lowlink.set(v, st.index);
  st.index++;
  st.tstack.push(v);
  st.onStack.add(v);
}

function tarjanEmitScc(v, st, cycles) {
  const comp = [];
  let w;
  do {
    w = st.tstack.pop();
    st.onStack.delete(w);
    comp.push(w);
  } while (w !== v);
  if (comp.length > 1) cycles.push(comp.sort());
}

function findCycles(adj) {
  const st = { indexOf: new Map(), lowlink: new Map(), onStack: new Set(), tstack: [], index: 0 };
  const cycles = [];
  for (const root of adj.keys()) {
    if (st.indexOf.has(root)) continue;
    tarjanPush(root, st);
    const work = [{ v: root, nbrs: adj.get(root) || [], i: 0 }];
    while (work.length) {
      const f = work[work.length - 1];
      if (f.i < f.nbrs.length) {
        const w = f.nbrs[f.i++];
        if (!st.indexOf.has(w)) {
          tarjanPush(w, st);
          work.push({ v: w, nbrs: adj.get(w) || [], i: 0 });
        } else if (st.onStack.has(w)) {
          st.lowlink.set(f.v, Math.min(st.lowlink.get(f.v), st.indexOf.get(w)));
        }
      } else {
        if (st.lowlink.get(f.v) === st.indexOf.get(f.v)) tarjanEmitScc(f.v, st, cycles);
        work.pop();
        if (work.length) {
          const p = work[work.length - 1].v;
          st.lowlink.set(p, Math.min(st.lowlink.get(p), st.lowlink.get(f.v)));
        }
      }
    }
  }
  return cycles;
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
