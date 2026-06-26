'use strict';

// Pure, deterministic wave/branch/base planner for per-cluster stacked PRs.
// No git, no network, no file I/O in planWaves — callers pass parsed inputs so
// the topology logic is unit-testable (mirrors build-chain-state.js). The CLI
// entrypoint reads the canonical spec files and prints the plan as JSON.

const fs = require('fs');

function unfinishedGroupIds(graph, features) {
  const failing = new Set(
    (features || [])
      .filter((f) => f && f.passes === false && f.group != null)
      .map((f) => String(f.group)),
  );
  return graph.groups.map((g) => String(g.id)).filter((id) => failing.has(id));
}

function gitPlanFor(id, preds) {
  const branch = `auto/group-${id}`;
  if (preds.length === 0) return { id, branch, base: 'main', mergeIn: [] };
  if (preds.length === 1) return { id, branch, base: `auto/group-${preds[0]}`, mergeIn: [] };
  return { id, branch, base: 'main', mergeIn: preds.map((p) => `auto/group-${p}`) };
}

function topologicalWaves(todo, activePreds) {
  const waves = [];
  const placed = new Set();
  while (placed.size < todo.length) {
    const layer = todo
      .filter((id) => !placed.has(id))
      .filter((id) => activePreds.get(id).every((p) => placed.has(p)))
      .sort();
    if (layer.length === 0) throw new Error('wave-plan: dependency cycle among unfinished groups');
    waves.push(layer.map((id) => gitPlanFor(id, activePreds.get(id))));
    layer.forEach((id) => placed.add(id));
  }
  return waves;
}

function planWaves(graph, features, options = {}) {
  if (!graph || !Array.isArray(graph.groups)) {
    throw new Error('wave-plan: graph.groups must be an array');
  }
  const todo = unfinishedGroupIds(graph, features);
  const todoSet = new Set(todo);
  const byId = new Map(graph.groups.map((g) => [String(g.id), g]));

  // active predecessors = blockedBy edges that are themselves still unfinished
  const activePreds = new Map();
  for (const id of todo) {
    const group = byId.get(id);
    const preds = (group.blockedBy || []).map(String).filter((p) => todoSet.has(p)).sort();
    activePreds.set(id, preds);
  }

  const waves = topologicalWaves(todo, activePreds);
  const prMode = (todo.length <= 1 || options.singlePr) ? 'integrated' : 'per-cluster';
  return { pr_mode: prMode, waves };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const singlePr = args.includes('--single-pr');
  const graphPath = argValue(args, '--graph') || 'specs/stories/dependency-graph.json';
  const featuresPath = argValue(args, '--features') || 'features.json';
  let graph;
  try {
    graph = readJson(graphPath);
  } catch (e) {
    process.stderr.write(`wave-plan: cannot read ${graphPath}: ${e.message}\n`);
    process.exit(2);
  }
  let features = [];
  try { features = readJson(featuresPath); } catch (_) { features = []; }
  try {
    process.stdout.write(`${JSON.stringify(planWaves(graph, features, { singlePr }), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { planWaves, unfinishedGroupIds };
