'use strict';

// Input validation for the ownership clusterer. A malformed story graph must
// fail here, at /spec, with a message naming the problem — not silently produce
// a plausible-looking plan that blows up later in wave-plan.js at /auto time.

const assert = require('assert');
const { test } = require('node:test');

const { planClusters } = require('../.claude/scripts/story-clusters.js');

const s = (id, opts = {}) => ({
  id,
  epic: id.split('-')[0],
  layer: opts.layer || 'Service',
  group: 'A',
  story_points: opts.story_points == null ? 3 : opts.story_points,
  readiness: opts.readiness || 'ready',
  depends_on: opts.depends_on || [],
});

const behavior = (to) => ({ story: to, kind: 'behavior' });
const contract = (to, artifact) => ({ story: to, kind: 'contract', artifact });

test('a two-story dependency cycle is rejected, not clustered', () => {
  assert.throws(
    () => planClusters({
      stories: [
        s('E1-S1', { depends_on: [behavior('E1-S2')] }),
        s('E1-S2', { depends_on: [behavior('E1-S1')] }),
      ],
    }),
    /cycle/i,
  );
});

test('the cycle error names every story on the cycle', () => {
  try {
    planClusters({
      stories: [
        s('E1-S1', { depends_on: [behavior('E1-S3')] }),
        s('E1-S2', { depends_on: [behavior('E1-S1')] }),
        s('E1-S3', { depends_on: [behavior('E1-S2')] }),
      ],
    });
    assert.fail('expected a cycle error');
  } catch (e) {
    for (const id of ['E1-S1', 'E1-S2', 'E1-S3']) {
      assert.match(e.message, new RegExp(id), `cycle message must name ${id}`);
    }
  }
});

test('a cycle made of cuttable contract edges is still a cycle', () => {
  assert.throws(
    () => planClusters({
      stories: [
        s('E1-S1', { layer: 'Types', depends_on: [contract('E2-S1', 'a')] }),
        s('E2-S1', { layer: 'Types', depends_on: [contract('E1-S1', 'b')] }),
      ],
    }),
    /cycle/i,
  );
});

test('a story depending on itself is a cycle', () => {
  assert.throws(
    () => planClusters({ stories: [s('E1-S1', { depends_on: [behavior('E1-S1')] })] }),
    /cycle/i,
  );
});

test('a diamond is not a cycle', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1'),
      s('E1-S2', { depends_on: [behavior('E1-S1')] }),
      s('E1-S3', { depends_on: [behavior('E1-S1')] }),
      s('E1-S4', { depends_on: [behavior('E1-S2'), behavior('E1-S3')] }),
    ],
  });
  assert.strictEqual(plan.cluster_count, 1);
});

test('two independent chains are not a cycle', () => {
  const plan = planClusters({
    stories: [
      s('E1-S1'), s('E1-S2', { depends_on: [behavior('E1-S1')] }),
      s('E2-S1'), s('E2-S2', { depends_on: [behavior('E2-S1')] }),
    ],
  });
  assert.strictEqual(plan.cluster_count, 2);
});
