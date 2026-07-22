'use strict';

// Ownership clustering for story allocation across a team.
//
// This is NOT the wave planner. `dependency-graph.json` groups stories by
// topological DEPTH ("group A has no dependencies, group B depends only on A"),
// which answers "what can be scheduled next". That is orthogonal to "which set
// of stories can one engineer own end to end", which is a connected-component
// problem over the dependency edges. A depth level mixes unrelated subsystems
// into one branch; a vertical slice spans three depth levels. Both views are
// needed — this adds the ownership one and leaves waves untouched.
//
// Pure core (planClusters) does no I/O so the topology logic is unit-testable;
// the CLI reads the canonical spec files. Mirrors wave-plan.js.

const fs = require('fs');
const path = require('path');

const {
  HARD_KINDS, CUTTABLE_KINDS, asArray, cmp, pointsOf,
  normalizeEdges, assertAcyclic, connectedComponents, splitOversized, mergeUndersized, resolveContractStory,
} = require('../hooks/lib/story-graph');

const DEFAULTS = { maxPointsPerCluster: 21, minPointsPerCluster: 5 };

function readyStories(stories) {
  return asArray(stories)
    .filter((s) => s && s.readiness !== 'needs_breakdown')
    .slice()
    .sort((a, b) => cmp(a.id, b.id));
}

function buildContext(ready, allStories) {
  const edges = normalizeEdges(ready, asArray(allStories));
  assertAcyclic(ready.map((s) => s.id), edges);
  const depsOf = new Map(ready.map((s) => [s.id, []]));
  for (const e of edges) depsOf.get(e.from).push(e.to);
  return {
    edges,
    depsOf,
    byId: new Map(ready.map((s) => [s.id, s])),
    points: new Map(ready.map((s) => [s.id, pointsOf(s)])),
  };
}

function partition(ready, ctx, opts) {
  const hardEdges = ctx.edges.filter((e) => HARD_KINDS.has(e.kind));
  const base = connectedComponents(ready.map((s) => s.id), hardEdges);
  const split = splitOversized(base, hardEdges, ctx.points, opts.maxPointsPerCluster);
  return mergeUndersized(split, ctx.edges, ctx.points, opts);
}

function describeCrossings(crossing, clusterOf, ctx) {
  const interface_contracts = crossing
    .filter((e) => CUTTABLE_KINDS.has(e.kind))
    .map((e, i) => ({
      id: `IC-${i + 1}`,
      artifact: e.artifact,
      kind: e.kind,
      producer_cluster: clusterOf.get(e.to),
      consumer_cluster: clusterOf.get(e.from),
      edge: { from: e.from, to: e.to },
      contract_story: resolveContractStory(e.to, ctx.byId, ctx.depsOf),
      reason: e.reason,
    }));
  const blocking_dependencies = crossing
    .filter((e) => HARD_KINDS.has(e.kind))
    .map((e, i) => ({
      id: `BD-${i + 1}`,
      kind: e.kind,
      producer_cluster: clusterOf.get(e.to),
      blocked_cluster: clusterOf.get(e.from),
      edge: { from: e.from, to: e.to },
      reason: e.reason,
    }));
  return { interface_contracts, blocking_dependencies };
}

function describeCluster(comp, index, ctx, blocking) {
  const id = `C${index + 1}`;
  const inside = new Set(comp.members);
  const internal = ctx.edges.filter((e) => inside.has(e.from) && inside.has(e.to)).length;
  const external = ctx.edges.filter((e) => inside.has(e.from) !== inside.has(e.to)).length;
  const members = comp.members.map((m) => ctx.byId.get(m));
  const distinct = (key) => [...new Set(members.map((m) => m[key]).filter(Boolean))].sort(cmp);
  return {
    id,
    stories: comp.members,
    story_points: comp.members.reduce((n, m) => n + ctx.points.get(m), 0),
    layers: distinct('layer'),
    epics: distinct('epic'),
    waves: distinct('group'),
    internal_edges: internal,
    external_edges: external,
    coordination_cost: Math.round((external / (internal + 1)) * 100) / 100,
    independently_startable: !blocking.some((b) => b.blocked_cluster === id),
    oversized: comp.oversized === true,
  };
}

function buildWarnings(clusters, unresolved, maxPoints) {
  const warnings = clusters.filter((c) => c.oversized).map(
    (c) => `cluster ${c.id} is oversized (${c.story_points} points > ${maxPoints} cap) and has no bridge to `
      + 'split on — it is tightly coupled. Decompose the epic or give it one owner.',
  );
  return warnings.concat(unresolved.map(
    (c) => `interface contract ${c.id} (${c.artifact || 'unnamed artifact'}) has no interface-layer story to `
      + `publish it, so ${c.consumer_cluster} cannot start before ${c.producer_cluster} ships ${c.edge.to}. `
      + 'Add a Types/Config story for the artifact.',
  ));
}

function planClusters({ stories, options } = {}) {
  const opts = { ...DEFAULTS, ...(options || {}) };
  const ready = readyStories(stories);
  if (ready.length === 0) {
    throw new Error('story-clusters: no ready stories to cluster — nothing to allocate');
  }
  const ctx = buildContext(ready, stories);
  const comps = partition(ready, ctx, opts);

  const clusterOf = new Map();
  comps.forEach((comp, i) => comp.members.forEach((id) => clusterOf.set(id, `C${i + 1}`)));
  const crossing = ctx.edges.filter((e) => clusterOf.get(e.from) !== clusterOf.get(e.to));
  const { interface_contracts, blocking_dependencies } = describeCrossings(crossing, clusterOf, ctx);

  const clusters = comps.map((comp, i) => describeCluster(comp, i, ctx, blocking_dependencies));
  const unresolved_contracts = interface_contracts.filter((c) => c.contract_story === null);
  return {
    cluster_count: clusters.length,
    max_points_per_cluster: opts.maxPointsPerCluster,
    min_points_per_cluster: opts.minPointsPerCluster,
    clusters,
    interface_contracts,
    unresolved_contracts,
    blocking_dependencies,
    warnings: buildWarnings(clusters, unresolved_contracts, opts.maxPointsPerCluster),
  };
}

// --- CLI ----------------------------------------------------------------------

function argValue(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function loadStories(storiesPath) {
  try {
    return JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
  } catch (e) {
    process.stderr.write(
      `story-clusters: cannot read ${storiesPath}: ${e.message}\n`
      + '  /spec Step 3 writes this machine-readable story index alongside the .md files.\n',
    );
    return process.exit(2);
  }
}

function writeOut(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function report(plan) {
  const startable = plan.clusters.filter((c) => c.independently_startable).length;
  process.stdout.write(
    `story-clusters: ${plan.cluster_count} cluster(s), ${startable} independently startable, `
    + `${plan.interface_contracts.length} interface contract(s), `
    + `${plan.blocking_dependencies.length} blocking dependency(ies)\n`,
  );
  for (const w of plan.warnings) process.stdout.write(`  WARN  ${w}\n`);
  if (plan.unresolved_contracts.length > 0) {
    process.stderr.write(
      `story-clusters: FAIL — ${plan.unresolved_contracts.length} interface contract(s) have no publishing `
      + 'story; the cut is not real and those clusters are not independent.\n',
    );
    process.exit(1);
  }
  process.stdout.write('story-clusters: PASS\n');
}

function main() {
  const args = process.argv.slice(2);
  const stories = loadStories(argValue(args, '--stories') || 'specs/stories/stories.json');
  const opts = {
    maxPointsPerCluster: Number(argValue(args, '--max-points')) || DEFAULTS.maxPointsPerCluster,
    minPointsPerCluster: Number(argValue(args, '--min-points')) || DEFAULTS.minPointsPerCluster,
  };
  let plan;
  let edges;
  try {
    plan = planClusters({ stories, options: opts });
    edges = normalizeEdges(readyStories(stories), stories);
  } catch (e) {
    process.stderr.write(`story-clusters: ${e.message}\n`);
    return process.exit(2);
  }
  writeOut(argValue(args, '--out') || 'specs/stories/story-clusters.json', plan);
  writeOut(argValue(args, '--edges-out') || 'specs/stories/dependency-edges.json', edges);
  return report(plan);
}

module.exports = { planClusters, normalizeEdges, DEFAULTS };

if (require.main === module) main();
