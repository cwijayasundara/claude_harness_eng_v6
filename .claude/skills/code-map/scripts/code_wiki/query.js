'use strict';

// Deterministic structured queries over the model — "ask the code-map" without
// an LLM. Downstream skills (/change, /refactor) call these instead of grepping
// or reading the six narrative essays.

// What depends on / calls `id` (fan-in sources).
function callers(model, id) {
  return model.edges.filter((e) => e.to === id).map((e) => ({ from: e.from, type: e.type, evidence: e.evidence }));
}

// What `id` depends on / calls (fan-out targets).
function calls(model, id) {
  return model.edges.filter((e) => e.from === id).map((e) => ({ to: e.to, type: e.type, evidence: e.evidence }));
}

// Where a symbol is defined: file + line, across all nodes.
function symbol(model, name) {
  const hits = [];
  for (const n of model.nodes) {
    for (const s of n.symbols) {
      if (s.name === name) hits.push({ file: n.id, line: s.line, kind: s.kind, signature: s.signature || null });
    }
  }
  return hits;
}

// A focused module view: its symbols + who calls it + what it calls.
function moduleView(model, id) {
  const n = model.byId.get(id);
  if (!n) return null;
  return {
    id, type: n.type,
    fanIn: model.fanIn.get(id) || 0, fanOut: model.fanOut.get(id) || 0,
    symbols: n.symbols, callers: callers(model, id), calls: calls(model, id),
  };
}

function run(model, opts) {
  if (opts.callers) return { query: 'callers', target: opts.callers, result: callers(model, opts.callers) };
  if (opts.calls) return { query: 'calls', target: opts.calls, result: calls(model, opts.calls) };
  if (opts.symbol) return { query: 'symbol', target: opts.symbol, result: symbol(model, opts.symbol) };
  if (opts.module) return { query: 'module', target: opts.module, result: moduleView(model, opts.module) };
  if (opts.hubs) return { query: 'hubs', result: model.hubs };
  if (opts.cycles) return { query: 'cycles', result: model.cycles };
  return { query: 'overview', result: { nodes: model.nodes.length, edges: model.edges.length, clusters: model.clusters.length, hubs: model.hubs.slice(0, 5), entrypoints: model.entrypoints.slice(0, 10) } };
}

module.exports = { callers, calls, symbol, moduleView, run };
