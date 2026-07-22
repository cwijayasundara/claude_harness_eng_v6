'use strict';

// Cluster independence measured against real file ownership. Edge-level
// independence (story-clusters.js) says two clusters have no dependency between
// them. It cannot see that both intend to edit the same file — which is what
// actually collides when two engineers work in parallel.

const assert = require('assert');
const { test } = require('node:test');

const { checkClusterCollisions, parseStoryOwnership } = require('../.claude/scripts/ownership-check.js');

const MAP = `
# Component Map

| Story | Files |
|---|---|
| E1-S1 | \`src/auth/types.ts\` |
| E1-S2 | \`src/auth/service.ts\`, \`src/auth/routes.ts\` |
| E2-S1 | \`src/orders/service.ts\` |
`;

const clusters = (...groups) => ({
  clusters: groups.map((stories, i) => ({ id: `C${i + 1}`, stories })),
});

test('parseStoryOwnership maps each story id to the paths on its row', () => {
  const owned = parseStoryOwnership(MAP);
  assert.deepStrictEqual(owned.get('E1-S1'), ['src/auth/types.ts']);
  assert.deepStrictEqual(owned.get('E1-S2'), ['src/auth/service.ts', 'src/auth/routes.ts']);
  assert.deepStrictEqual(owned.get('E2-S1'), ['src/orders/service.ts']);
});

test('parseStoryOwnership ignores backticked tokens on rows with no story id', () => {
  const owned = parseStoryOwnership('Some prose about `src/stray.ts` with no story.');
  assert.strictEqual(owned.size, 0);
});

test('disjoint file ownership across clusters is a clean pass', () => {
  const v = checkClusterCollisions(MAP, clusters(['E1-S1', 'E1-S2'], ['E2-S1']));
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.collisions, []);
  assert.strictEqual(v.files_checked, 4);
});

test('two stories in the SAME cluster sharing a file is not a collision', () => {
  const map = `${MAP}| E1-S3 | \`src/auth/service.ts\` |\n`;
  const v = checkClusterCollisions(map, clusters(['E1-S1', 'E1-S2', 'E1-S3'], ['E2-S1']));
  assert.strictEqual(v.pass, true);
});

test('the same file owned by stories in two clusters is a collision naming both', () => {
  const map = `${MAP}| E2-S2 | \`src/auth/service.ts\` |\n`;
  const v = checkClusterCollisions(map, clusters(['E1-S1', 'E1-S2'], ['E2-S1', 'E2-S2']));
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.collisions.length, 1);
  assert.strictEqual(v.collisions[0].file, 'src/auth/service.ts');
  assert.deepStrictEqual(v.collisions[0].clusters, ['C1', 'C2']);
  assert.deepStrictEqual(v.collisions[0].stories, ['E1-S2', 'E2-S2']);
});

test('collisions are sorted deterministically', () => {
  const map = `${MAP}| E2-S2 | \`src/auth/service.ts\`, \`src/auth/types.ts\` |\n`;
  const a = checkClusterCollisions(map, clusters(['E1-S1', 'E1-S2'], ['E2-S1', 'E2-S2']));
  const b = checkClusterCollisions(map, clusters(['E1-S2', 'E1-S1'], ['E2-S2', 'E2-S1']));
  assert.deepStrictEqual(a.collisions.map((c) => c.file), ['src/auth/service.ts', 'src/auth/types.ts']);
  assert.deepStrictEqual(a, b);
});

test('a story in the map but in no cluster is reported, not silently dropped', () => {
  const v = checkClusterCollisions(MAP, clusters(['E1-S1', 'E1-S2']));
  assert.deepStrictEqual(v.unclustered_stories, ['E2-S1']);
});

test('a cluster story absent from the component map is reported as unmapped', () => {
  const v = checkClusterCollisions(MAP, clusters(['E1-S1', 'E1-S2'], ['E2-S1', 'E9-S9']));
  assert.deepStrictEqual(v.unmapped_stories, ['E9-S9']);
});

test('an empty map with real clusters is a broken control, never a vacuous pass', () => {
  const v = checkClusterCollisions('# Component Map\n\nTBD\n', clusters(['E1-S1'], ['E2-S1']));
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.reason, 'empty_map');
});

test('no clusters at all is a broken control, not a pass', () => {
  const v = checkClusterCollisions(MAP, { clusters: [] });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.reason, 'no_clusters');
});
