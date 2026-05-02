'use strict';

const fs = require('fs');
const path = require('path');

const { LANG_BY_SUFFIX, extractFile } = require('./extractors');

const DEFAULT_EXCLUDES = new Set([
  'node_modules', '.venv', 'venv', 'env', 'dist', 'build', 'target',
  'vendor', '.git', '__pycache__', '.mypy_cache', '.ruff_cache',
  '.next', '.nuxt', '.pytest_cache', '.tox', 'out', 'bin', 'obj',
  'coverage', '.coverage', 'htmlcov',
]);

function walkFiles(root, excludes) {
  const results = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludes.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (LANG_BY_SUFFIX[ext]) results.push(full);
      }
    }
  }
  return results;
}

function buildGraph(root, excludes) {
  const absRoot = path.resolve(root);
  const files = walkFiles(absRoot, excludes);
  const nodes = new Map();
  const edges = [];
  const warnings = [];
  const langCounts = {};

  for (const f of files) {
    const rel = path.relative(absRoot, f).split(path.sep).join('/');
    const result = extractFile(f, rel);
    nodes.set(result.node.id, result.node);
    edges.push(...result.edges);
    warnings.push(...result.warnings);
    langCounts[result.node.language] = (langCounts[result.node.language] || 0) + 1;
  }

  const resolved = resolveInternalEdges(nodes, edges);
  const metrics = computeMetrics(nodes, resolved);

  return {
    nodes: [...nodes.values()],
    edges: resolved,
    metrics,
    meta: {
      producer: 'vendored',
      languages: langCounts,
      warnings,
      generated_at: new Date().toISOString(),
      root: absRoot,
    },
  };
}

function pythonModuleParents(mod) {
  const parts = mod.split('.');
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join('.'));
  }
  return out;
}

function resolveInternalEdges(nodes, edges) {
  const byModule = new Map();
  const push = (key, id) => {
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(id);
  };
  for (const n of nodes.values()) {
    if (n.language === 'python') {
      const mod = n.path.replace(/\//g, '.').replace(/\.py$/, '');
      push(mod, n.id);
      for (const parent of pythonModuleParents(mod)) push(parent, n.id);
    } else {
      const stem = n.path.replace(/\.[^/.]+$/, '');
      push(stem, n.id);
      const base = path.basename(stem);
      push(base, n.id);
    }
  }

  return edges.map((e) => {
    if (!e.target.startsWith('ext:')) return e;
    const raw = e.target.slice(4);
    const lookups = candidateKeys(raw, e.source, nodes);
    for (const key of lookups) {
      const cands = byModule.get(key);
      if (cands && cands[0] !== e.source) {
        return { ...e, target: cands[0] };
      }
    }
    return e;
  });
}

function candidateKeys(raw, sourceId, nodes) {
  const keys = [raw];
  const sourceNode = nodes.get(sourceId);
  if (sourceNode && (raw.startsWith('./') || raw.startsWith('../'))) {
    const sourceDir = path.posix.dirname(sourceNode.path);
    const resolved = path.posix.normalize(path.posix.join(sourceDir, raw));
    keys.push(resolved);
    keys.push(resolved.replace(/\.[^/.]+$/, ''));
    keys.push(path.posix.basename(resolved));
    keys.push(path.posix.basename(resolved).replace(/\.[^/.]+$/, ''));
  }
  const head = raw.split(/[./]/).find(Boolean);
  if (head) keys.push(head);
  return keys;
}

function instability(fanIn, fanOut) {
  const total = fanIn + fanOut;
  return total === 0 ? 0 : Math.round((fanOut / total) * 1000) / 1000;
}

function computeMetrics(nodes, edges) {
  const fanIn = new Map();
  const fanOut = new Map();
  const adj = new Map();
  for (const e of edges) {
    if (e.target.startsWith('ext:') || e.target.startsWith('sym:')) continue;
    if (!nodes.has(e.target) || !nodes.has(e.source)) continue;
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
    fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    adj.get(e.source).add(e.target);
  }

  const cycles = findCycles(adj);
  const hubsAll = [];
  for (const id of nodes.keys()) {
    const fi = fanIn.get(id) || 0;
    const fo = fanOut.get(id) || 0;
    if (fi + fo === 0) continue;
    hubsAll.push({ id, fan_in: fi, fan_out: fo, instability: instability(fi, fo) });
  }
  hubsAll.sort((a, b) => (b.fan_in - a.fan_in) || (b.fan_out - a.fan_out));

  let internalEdges = 0;
  let externalImports = 0;
  for (const e of edges) {
    if (e.target.startsWith('ext:')) externalImports++;
    else if (!e.target.startsWith('sym:')) internalEdges++;
  }

  return {
    files: nodes.size,
    edges: internalEdges,
    external_imports: externalImports,
    cycles,
    hubs: hubsAll.slice(0, 25),
  };
}

function findCycles(adj) {
  const indexOf = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  let counter = 0;

  function strongconnect(v) {
    const work = [{ v, iter: (adj.get(v) || new Set()).values(), phase: 0 }];
    indexOf.set(v, counter); lowlink.set(v, counter); counter++;
    stack.push(v); onStack.add(v);

    while (work.length) {
      const frame = work[work.length - 1];
      const next = frame.iter.next();
      if (next.done) {
        const node = frame.v;
        if (lowlink.get(node) === indexOf.get(node)) {
          const comp = [];
          while (true) {
            const w = stack.pop();
            onStack.delete(w);
            comp.push(w);
            if (w === node) break;
          }
          if (comp.length > 1) cycles.push(comp.sort());
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1];
          parent.lastChild = node;
          lowlink.set(parent.v, Math.min(lowlink.get(parent.v), lowlink.get(node)));
        }
        continue;
      }
      const w = next.value;
      if (!indexOf.has(w)) {
        indexOf.set(w, counter); lowlink.set(w, counter); counter++;
        stack.push(w); onStack.add(w);
        work.push({ v: w, iter: (adj.get(w) || new Set()).values(), phase: 0 });
      } else if (onStack.has(w)) {
        lowlink.set(frame.v, Math.min(lowlink.get(frame.v), indexOf.get(w)));
      }
    }
  }

  for (const v of adj.keys()) {
    if (!indexOf.has(v)) strongconnect(v);
  }
  return cycles;
}

module.exports = { DEFAULT_EXCLUDES, walkFiles, buildGraph };
