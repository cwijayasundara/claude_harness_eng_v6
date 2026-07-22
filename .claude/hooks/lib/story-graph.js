'use strict';

// Graph algebra over the story dependency edges. Pure, deterministic, no I/O.
// Consumed by .claude/scripts/story-clusters.js, which composes these into an
// ownership-cluster plan.
//
// The lever that creates parallelism is the edge KIND:
//   contract | ui    — cuttable. The consumer needs the producer's *shape*
//                      (a type, a schema, an endpoint), so publishing the
//                      interface first lets both engineers work at once.
//   data | behavior  — hard. The consumer needs the producer's runtime effect.
//                      Cutting one yields a hand-off, not parallelism.

const HARD_KINDS = new Set(['data', 'behavior']);
const CUTTABLE_KINDS = new Set(['contract', 'ui']);
// Layers whose stories publish an interface rather than a behavior, so a
// contract edge onto one can genuinely be satisfied before the producer ships.
const INTERFACE_LAYERS = new Set(['Types', 'Config']);

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function edgeKey(e) {
  return `${e.from} ${e.to} ${e.kind} ${e.artifact || ''}`;
}

function pointsOf(story) {
  const p = story && story.story_points;
  return typeof p === 'number' && Number.isFinite(p) ? p : 0;
}

// One dependency -> one validated edge. Accepts the legacy bare-string form
// (read as a behavior edge) and the typed { story, kind, artifact, reason } form.
function toEdge(story, dep, known, universe) {
  const d = typeof dep === 'string' ? { story: dep } : dep || {};
  const kind = d.kind || 'behavior';
  if (!HARD_KINDS.has(kind) && !CUTTABLE_KINDS.has(kind)) {
    throw new Error(
      `story-clusters: unknown dependency kind "${kind}" on ${story.id} — expected contract|data|behavior|ui`,
    );
  }
  const to = d.story;
  if (!to || !universe.has(to)) {
    throw new Error(`story-clusters: ${story.id} depends on unknown story "${to}"`);
  }
  if (!known.has(to)) {
    throw new Error(
      `story-clusters: ready story ${story.id} depends on non-ready story "${to}" — break it down first`,
    );
  }
  return {
    from: story.id,
    to,
    kind,
    artifact: d.artifact == null ? null : d.artifact,
    reason: d.reason == null ? null : d.reason,
  };
}

function normalizeEdges(stories, allStories) {
  const list = asArray(stories);
  const known = new Set(list.map((s) => s.id));
  const universe = new Set(asArray(allStories || list).map((s) => s.id));
  const edges = list.flatMap(
    (story) => asArray(story.depends_on).map((dep) => toEdge(story, dep, known, universe)),
  );
  return edges.sort((a, b) => cmp(edgeKey(a), edgeKey(b)));
}

// A cyclic story graph cannot be ordered. wave-plan.js already throws on one,
// but that is at /auto time — long after the plan was reviewed and allocated.
// Catching it here means a cycle surfaces while the decomposition is still open.
function assertAcyclic(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  for (const e of edges) out.get(e.from).push(e.to);
  const state = new Map(ids.map((id) => [id, 'new']));

  const walk = (id, path) => {
    state.set(id, 'open');
    for (const next of (out.get(id) || []).slice().sort(cmp)) {
      if (state.get(next) === 'open') {
        const cycle = path.slice(path.indexOf(next)).concat(next);
        throw new Error(`story-clusters: dependency cycle — ${cycle.join(' -> ')}`);
      }
      if (state.get(next) === 'new') walk(next, path.concat(next));
    }
    state.set(id, 'done');
  };

  for (const id of ids.slice().sort(cmp)) {
    if (state.get(id) === 'new') walk(id, [id]);
  }
}

function connectedComponents(ids, edges) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => {
    let node = x;
    while (parent.get(node) !== node) {
      parent.set(node, parent.get(parent.get(node)));
      node = parent.get(node);
    }
    return node;
  };
  for (const e of edges) {
    const [ra, rb] = [find(e.from), find(e.to)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }

  const byRoot = new Map();
  for (const id of ids) {
    const root = find(id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(id);
  }
  return [...byRoot.values()]
    .map((members) => members.slice().sort(cmp))
    .sort((a, b) => cmp(a[0], b[0]));
}

function inducedEdges(members, edgeList) {
  const inside = new Set(members);
  return edgeList.filter((e) => inside.has(e.from) && inside.has(e.to));
}

function reachableFrom(start, members, edgeList, skipIndex) {
  const inside = new Set(members);
  const adj = new Map(members.map((m) => [m, []]));
  edgeList.forEach((e, i) => {
    if (i === skipIndex) return;
    if (!inside.has(e.from) || !inside.has(e.to)) return;
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  });
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const next of adj.get(stack.pop()) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

// Split on the bridge that most evenly balances story points. Returns null when
// the component is biconnected — a genuinely tangled blob that cannot be handed
// to two engineers without inventing a boundary that does not exist.
function trySplit(members, hardEdges, points) {
  const induced = inducedEdges(members, hardEdges);
  const total = members.reduce((n, id) => n + points.get(id), 0);
  let best = null;
  induced.forEach((edge, i) => {
    const side = reachableFrom(edge.from, members, induced, i);
    if (side.has(edge.to)) return; // not a bridge — the pair stays connected
    const a = members.filter((m) => side.has(m));
    const balance = Math.abs(a.reduce((n, id) => n + points.get(id), 0) * 2 - total);
    const key = edgeKey(edge);
    if (!best || balance < best.balance || (balance === best.balance && cmp(key, best.key) < 0)) {
      best = { balance, key, a, b: members.filter((m) => !side.has(m)) };
    }
  });
  return best ? [best.a, best.b] : null;
}

function splitOversized(components, hardEdges, points, maxPoints) {
  const queue = components.map((members) => ({ members, oversized: false }));
  const settled = [];
  while (queue.length) {
    const comp = queue.shift();
    if (comp.members.reduce((n, id) => n + points.get(id), 0) <= maxPoints) {
      settled.push(comp);
      continue;
    }
    const halves = trySplit(comp.members, hardEdges, points);
    if (!halves) {
      comp.oversized = true;
      settled.push(comp);
      continue;
    }
    queue.push({ members: halves[0], oversized: false }, { members: halves[1], oversized: false });
  }
  return settled.sort((a, b) => cmp(a.members[0], b.members[0]));
}

// Cuttable edges running between two components — the coordination surface they
// already share, and therefore the best merge partner for a tiny component.
function sharedCutEdges(a, b, edges) {
  const inA = new Set(a.members);
  const inB = new Set(b.members);
  return edges.filter(
    (e) => CUTTABLE_KINDS.has(e.kind)
      && ((inA.has(e.from) && inB.has(e.to)) || (inB.has(e.from) && inA.has(e.to))),
  ).length;
}

function bestMergePartner(comp, comps, edges, totalOf, maxPoints) {
  let best = null;
  for (const peer of comps) {
    if (peer === comp || peer.oversized) continue;
    if (totalOf(peer) + totalOf(comp) > maxPoints) continue;
    const shared = sharedCutEdges(comp, peer, edges);
    if (shared === 0) continue;
    if (!best || shared > best.shared
      || (shared === best.shared && cmp(peer.members[0], best.peer.members[0]) < 0)) {
      best = { shared, peer };
    }
  }
  return best;
}

function mergeUndersized(components, edges, points, opts) {
  const totalOf = (c) => c.members.reduce((n, id) => n + points.get(id), 0);
  let comps = components.slice();
  let merged = true;
  while (merged) {
    merged = false;
    comps.sort((a, b) => cmp(a.members[0], b.members[0]));
    for (const comp of comps) {
      if (comp.oversized || totalOf(comp) >= opts.minPointsPerCluster) continue;
      const best = bestMergePartner(comp, comps, edges, totalOf, opts.maxPointsPerCluster);
      if (!best) continue;
      best.peer.members = best.peer.members.concat(comp.members).sort(cmp);
      comps = comps.filter((c) => c !== comp);
      merged = true;
      break;
    }
  }
  return comps.sort((a, b) => cmp(a.members[0], b.members[0]));
}

// The story that can publish this artifact ahead of the producer: the producer
// itself when it is an interface-layer story, else its nearest interface-layer
// ancestor. Null means the cut is fiction — the consumer must wait for the
// producer's behavior, so the two clusters are not really independent.
function resolveContractStory(producerId, byId, depsOf) {
  const seen = new Set();
  let frontier = [producerId];
  while (frontier.length) {
    const published = frontier
      .filter((id) => INTERFACE_LAYERS.has((byId.get(id) || {}).layer))
      .sort(cmp)[0];
    if (published) return published;
    const next = [];
    for (const id of frontier.slice().sort(cmp)) {
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dep of (depsOf.get(id) || []).slice().sort(cmp)) {
        if (!seen.has(dep)) next.push(dep);
      }
    }
    frontier = [...new Set(next)];
  }
  return null;
}

module.exports = {
  HARD_KINDS,
  CUTTABLE_KINDS,
  INTERFACE_LAYERS,
  asArray,
  cmp,
  pointsOf,
  normalizeEdges,
  assertAcyclic,
  connectedComponents,
  splitOversized,
  mergeUndersized,
  resolveContractStory,
};
