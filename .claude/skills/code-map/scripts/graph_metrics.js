'use strict';

// Shared graph metrics for code-graph producers (understand-anything, SCIP, …).
// Operates on the harness graph shape: nodes [{id,...}] + edges
// [{source,target,kind}]. external (ext:) targets are counted, not traversed.

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

  return {
    files: nodes.length,
    edges: internalEdges,
    external_imports: externalImports,
    cycles: findCycles(adj),
    hubs: rankHubs(byId, fanIn, fanOut),
  };
}

function rankHubs(byId, fanIn, fanOut) {
  const hubs = [];
  for (const id of byId) {
    const fi = fanIn.get(id) || 0;
    const fo = fanOut.get(id) || 0;
    if (fi + fo === 0) continue;
    hubs.push({ id, fan_in: fi, fan_out: fo, instability: instability(fi, fo) });
  }
  hubs.sort((a, b) => (b.fan_in - a.fan_in) || (b.fan_out - a.fan_out));
  return hubs.slice(0, 25);
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

function tarjanStep(f, st, work) {
  const w = f.nbrs[f.i++];
  if (!st.indexOf.has(w)) {
    tarjanPush(w, st);
    work.push({ v: w, nbrs: adjList(st.adj, w), i: 0 });
  } else if (st.onStack.has(w)) {
    st.lowlink.set(f.v, Math.min(st.lowlink.get(f.v), st.indexOf.get(w)));
  }
}

// Neighbors as an ARRAY. adj stores Sets; the Tarjan walk indexes nbrs[i], and
// indexing a Set yields undefined (the prior copy of this code did exactly that,
// so cycle detection was a silent no-op). Spreading to an array fixes traversal;
// acyclic graphs still yield no cycles, so existing outputs are unchanged.
function adjList(adj, v) {
  return [...(adj.get(v) || [])];
}

function findCycles(adj) {
  const st = { indexOf: new Map(), lowlink: new Map(), onStack: new Set(), tstack: [], index: 0, adj };
  const cycles = [];
  for (const root of adj.keys()) {
    if (st.indexOf.has(root)) continue;
    tarjanPush(root, st);
    const work = [{ v: root, nbrs: adjList(adj, root), i: 0 }];
    while (work.length) {
      const f = work[work.length - 1];
      if (f.i < f.nbrs.length) {
        tarjanStep(f, st, work);
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

module.exports = { instability, computeMetrics, findCycles };
