'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { planClusters, normalizeEdges } = require('../.claude/scripts/story-clusters.js');

// --- fixtures -----------------------------------------------------------------

// A ready story. `deps` accepts bare strings (legacy) or typed objects.
const s = (id, opts = {}) => ({
  id,
  title: opts.title || `${id} title`,
  epic: opts.epic || id.split('-')[0],
  layer: opts.layer || 'Service',
  group: opts.group || 'A',
  story_points: opts.story_points == null ? 3 : opts.story_points,
  readiness: opts.readiness || 'ready',
  depends_on: opts.depends_on || [],
});

const contract = (to, artifact) => ({ story: to, kind: 'contract', artifact: artifact || 'iface', reason: 'r' });
const behavior = (to) => ({ story: to, kind: 'behavior', artifact: null, reason: 'r' });

const idsOf = (plan) => plan.clusters.map((c) => c.stories);
const clusterOf = (plan, storyId) => plan.clusters.find((c) => c.stories.includes(storyId)).id;

// --- normalizeEdges -----------------------------------------------------------

test('normalizeEdges accepts a bare string dependency as a behavior edge', () => {
  const edges = normalizeEdges([s('E1-S1'), s('E1-S2', { depends_on: ['E1-S1'] })]);
  assert.deepStrictEqual(edges, [
    { from: 'E1-S2', to: 'E1-S1', kind: 'behavior', artifact: null, reason: null },
  ]);
});

test('normalizeEdges preserves kind, artifact and reason on a typed dependency', () => {
  const edges = normalizeEdges([s('E1-S1'), s('E1-S2', { depends_on: [contract('E1-S1', 'User type')] })]);
  assert.deepStrictEqual(edges[0], {
    from: 'E1-S2', to: 'E1-S1', kind: 'contract', artifact: 'User type', reason: 'r',
  });
});

test('normalizeEdges rejects an unknown dependency kind', () => {
  assert.throws(
    () => normalizeEdges([s('E1-S1'), s('E1-S2', { depends_on: [{ story: 'E1-S1', kind: 'vibes' }] })]),
    /unknown dependency kind.*vibes/i,
  );
});

test('normalizeEdges rejects a dependency on a story that does not exist', () => {
  assert.throws(
    () => normalizeEdges([s('E1-S2', { depends_on: ['E9-S9'] })]),
    /E9-S9/,
  );
});

test('normalizeEdges is order-independent', () => {
  const a = [s('E1-S1'), s('E1-S2', { depends_on: ['E1-S1'] }), s('E2-S1', { depends_on: ['E1-S1'] })];
  const b = [a[2], a[0], a[1]];
  assert.deepStrictEqual(normalizeEdges(a), normalizeEdges(b));
});

// --- clustering ---------------------------------------------------------------

test('disconnected hard chains become separate clusters, ids assigned deterministically', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1'), s('E1-S2', { depends_on: [behavior('E1-S1')] }),
      s('E2-S1'), s('E2-S2', { depends_on: [behavior('E2-S1')] }),
    ],
  });
  assert.strictEqual(plan.cluster_count, 2);
  assert.deepStrictEqual(idsOf(plan), [['E1-S1', 'E1-S2'], ['E2-S1', 'E2-S2']]);
  assert.deepStrictEqual(plan.clusters.map((c) => c.id), ['C1', 'C2']);
});

test('a hard edge keeps two stories in the same cluster', () => {
  const plan = planClusters({ stories: [s('E1-S1'), s('E1-S2', { depends_on: [behavior('E1-S1')] })] });
  assert.strictEqual(plan.cluster_count, 1);
});

test('a contract edge is cuttable — producer and consumer land in different clusters', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1', { layer: 'Types' }),
      s('E2-S1', { depends_on: [contract('E1-S1', 'User type')] }),
    ],
    options: { minPointsPerCluster: 0 },
  });
  assert.strictEqual(plan.cluster_count, 2);
  assert.notStrictEqual(clusterOf(plan, 'E1-S1'), clusterOf(plan, 'E2-S1'));
});

test('needs_breakdown stories are excluded from clustering entirely', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1'),
      s('E1-S2', { readiness: 'needs_breakdown', story_points: null }),
    ],
  });
  assert.deepStrictEqual(plan.clusters.flatMap((c) => c.stories), ['E1-S1']);
});

test('an empty story set fails loudly rather than returning an empty plan', () => {
  assert.throws(() => planClusters({ stories: [] }), /no ready stories/i);
  assert.throws(
    () => planClusters({ stories: [s('E1-S1', { readiness: 'needs_breakdown' })] }),
    /no ready stories/i,
  );
});

// --- splitting oversized components -------------------------------------------

test('an oversized hard chain splits on bridges until every cluster fits the cap', () => {
  const chain = [
    s('E1-S1', { story_points: 8 }),
    s('E1-S2', { story_points: 8, depends_on: [behavior('E1-S1')] }),
    s('E1-S3', { story_points: 8, depends_on: [behavior('E1-S2')] }),
    s('E1-S4', { story_points: 8, depends_on: [behavior('E1-S3')] }),
    s('E1-S5', { story_points: 8, depends_on: [behavior('E1-S4')] }),
  ];
  const plan = planClusters({ stories: chain, options: { maxPointsPerCluster: 21, minPointsPerCluster: 0 } });
  assert.ok(plan.clusters.every((c) => c.story_points <= 21), 'every cluster within cap');
  assert.strictEqual(plan.clusters.reduce((n, c) => n + c.stories.length, 0), 5);
});

test('splitting a hard edge produces a blocking dependency, not an interface contract', () => {
  const chain = [
    s('E1-S1', { story_points: 13 }),
    s('E1-S2', { story_points: 13, depends_on: [behavior('E1-S1')] }),
  ];
  const plan = planClusters({ stories: chain, options: { maxPointsPerCluster: 13, minPointsPerCluster: 0 } });
  assert.strictEqual(plan.cluster_count, 2);
  assert.strictEqual(plan.interface_contracts.length, 0);
  assert.strictEqual(plan.blocking_dependencies.length, 1);
  assert.deepStrictEqual(plan.blocking_dependencies[0].edge, { from: 'E1-S2', to: 'E1-S1' });
});

test('a cluster with an inbound hard cross-edge is not independently startable', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1', { story_points: 13 }),
      s('E1-S2', { story_points: 13, depends_on: [behavior('E1-S1')] }),
    ],
    options: { maxPointsPerCluster: 13, minPointsPerCluster: 0 },
  });
  const consumer = plan.clusters.find((c) => c.stories.includes('E1-S2'));
  const producer = plan.clusters.find((c) => c.stories.includes('E1-S1'));
  assert.strictEqual(consumer.independently_startable, false);
  assert.strictEqual(producer.independently_startable, true);
});

test('a tightly coupled oversized component cannot be split and is reported, not faked', () => {
  // triangle: every edge sits on a cycle, so no bridge exists
  const plan = planClusters({
    stories: [
      s('E1-S1', { story_points: 13 }),
      s('E1-S2', { story_points: 13, depends_on: [behavior('E1-S1')] }),
      s('E1-S3', { story_points: 13, depends_on: [behavior('E1-S1'), behavior('E1-S2')] }),
    ],
    options: { maxPointsPerCluster: 21, minPointsPerCluster: 0 },
  });
  assert.strictEqual(plan.cluster_count, 1);
  assert.strictEqual(plan.clusters[0].oversized, true);
  assert.ok(plan.warnings.some((w) => /oversized/i.test(w) && /C1/.test(w)));
});

// --- merging undersized components --------------------------------------------

test('an undersized cluster merges into the peer it shares the most cut edges with', () => {
  const plan = planClusters({
    stories: [
      // tiny standalone story with two contract edges into E2 and one into E3
      s('E1-S1', { story_points: 1, layer: 'Types' }),
      s('E2-S1', { story_points: 8, layer: 'Types', depends_on: [contract('E1-S1', 'a')] }),
      s('E2-S2', { story_points: 5, depends_on: [behavior('E2-S1'), contract('E1-S1', 'b')] }),
      s('E3-S1', { story_points: 8, layer: 'Types', depends_on: [contract('E1-S1', 'c')] }),
    ],
    options: { minPointsPerCluster: 5, maxPointsPerCluster: 21 },
  });
  assert.strictEqual(clusterOf(plan, 'E1-S1'), clusterOf(plan, 'E2-S1'));
  assert.notStrictEqual(clusterOf(plan, 'E1-S1'), clusterOf(plan, 'E3-S1'));
});

test('an undersized cluster is left standalone rather than force-merged when it shares no edges', () => {
  const plan = planClusters({
    stories: [s('E1-S1', { story_points: 1 }), s('E2-S1', { story_points: 8 })],
    options: { minPointsPerCluster: 5 },
  });
  assert.strictEqual(plan.cluster_count, 2);
});

test('a merge that would breach the point cap is not performed', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1', { story_points: 1, layer: 'Types' }),
      s('E2-S1', { story_points: 21, depends_on: [contract('E1-S1', 'a')] }),
    ],
    options: { minPointsPerCluster: 5, maxPointsPerCluster: 21 },
  });
  assert.strictEqual(plan.cluster_count, 2);
});

// --- interface contracts ------------------------------------------------------

test('a contract edge onto an interface-layer story resolves its contract_story', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1', { layer: 'Types', story_points: 8 }),
      s('E2-S1', { story_points: 8, depends_on: [contract('E1-S1', 'User type')] }),
    ],
    options: { minPointsPerCluster: 0 },
  });
  assert.strictEqual(plan.interface_contracts.length, 1);
  const ic = plan.interface_contracts[0];
  assert.strictEqual(ic.id, 'IC-1');
  assert.strictEqual(ic.artifact, 'User type');
  assert.strictEqual(ic.contract_story, 'E1-S1');
  assert.strictEqual(ic.producer_cluster, clusterOf(plan, 'E1-S1'));
  assert.strictEqual(ic.consumer_cluster, clusterOf(plan, 'E2-S1'));
  assert.deepStrictEqual(plan.unresolved_contracts, []);
});

test('a contract edge onto a behaviour-layer story with no interface ancestor is unresolved', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1', { layer: 'Service', story_points: 8 }),
      s('E2-S1', { story_points: 8, depends_on: [contract('E1-S1', 'Order total')] }),
    ],
    options: { minPointsPerCluster: 0 },
  });
  assert.strictEqual(plan.unresolved_contracts.length, 1);
  assert.strictEqual(plan.unresolved_contracts[0].artifact, 'Order total');
  assert.strictEqual(plan.interface_contracts[0].contract_story, null);
});

test('a contract edge resolves through an interface-layer ancestor of the producer', () => {
  const plan = planClusters({
    stories: [
      s('E1-S0', { layer: 'Types', story_points: 3 }),
      s('E1-S1', { layer: 'Service', story_points: 8, depends_on: [behavior('E1-S0')] }),
      s('E2-S1', { story_points: 8, depends_on: [contract('E1-S1', 'Order total')] }),
    ],
    options: { minPointsPerCluster: 0 },
  });
  assert.deepStrictEqual(plan.unresolved_contracts, []);
  assert.strictEqual(plan.interface_contracts[0].contract_story, 'E1-S0');
});

// --- cluster metrics ----------------------------------------------------------

test('cluster metrics report points, layers, epics, waves and coordination cost', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1', { layer: 'Types', group: 'A', story_points: 3 }),
      s('E1-S2', { layer: 'API', group: 'B', story_points: 5, depends_on: [behavior('E1-S1')] }),
      s('E2-S1', { layer: 'UI', group: 'C', story_points: 8, depends_on: [contract('E1-S1', 'User type')] }),
    ],
    options: { minPointsPerCluster: 0 },
  });
  const c = plan.clusters.find((x) => x.stories.includes('E1-S1'));
  assert.strictEqual(c.story_points, 8);
  assert.deepStrictEqual(c.layers, ['API', 'Types']);
  assert.deepStrictEqual(c.epics, ['E1']);
  assert.deepStrictEqual(c.waves, ['A', 'B']);
  assert.strictEqual(c.internal_edges, 1);
  assert.strictEqual(c.external_edges, 1);
  assert.strictEqual(c.coordination_cost, 0.5);
});

// --- determinism --------------------------------------------------------------

test('shuffled input produces byte-identical output', () => {
  const stories = [
    s('E1-S1', { layer: 'Types', story_points: 3 }),
    s('E1-S2', { story_points: 5, depends_on: [behavior('E1-S1')] }),
    s('E2-S1', { layer: 'Types', story_points: 8, depends_on: [contract('E1-S1', 'a')] }),
    s('E2-S2', { story_points: 5, depends_on: [behavior('E2-S1')] }),
    s('E3-S1', { story_points: 8, depends_on: [contract('E2-S1', 'b')] }),
  ];
  const shuffled = [stories[3], stories[0], stories[4], stories[1], stories[2]];
  const a = JSON.stringify(planClusters({ stories }), null, 2);
  const b = JSON.stringify(planClusters({ stories: shuffled }), null, 2);
  assert.strictEqual(a, b);
});
