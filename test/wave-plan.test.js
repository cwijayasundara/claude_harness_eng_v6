'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { planWaves } = require('../.claude/scripts/wave-plan.js');

// helpers: every group has at least one failing feature unless noted
const g = (groups) => ({ groups });
const failing = (...ids) => ids.map((group) => ({ group, passes: false }));

test('single unfinished group => integrated pr_mode', () => {
  const plan = planWaves(g([{ id: 'A', stories: ['S1'], blockedBy: [] }]), failing('A'));
  assert.strictEqual(plan.pr_mode, 'integrated');
  assert.strictEqual(plan.waves.length, 1);
  assert.deepStrictEqual(plan.waves[0][0], { id: 'A', branch: 'auto/group-A', base: 'main', mergeIn: [] });
});

test('two independent clusters => per-cluster, both based on main, one wave', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: [] }]),
    failing('A', 'B'),
  );
  assert.strictEqual(plan.pr_mode, 'per-cluster');
  assert.strictEqual(plan.waves.length, 1);
  assert.deepStrictEqual(plan.waves[0].map((x) => x.base), ['main', 'main']);
});

test('chain A->B => B stacks on auto/group-A in a later wave', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: ['A'] }]),
    failing('A', 'B'),
  );
  assert.strictEqual(plan.waves.length, 2);
  assert.deepStrictEqual(plan.waves[1][0], { id: 'B', branch: 'auto/group-B', base: 'auto/group-A', mergeIn: [] });
});

test('diamond A->{B,C}->D => D bases on main and merges in B and C', () => {
  const plan = planWaves(
    g([
      { id: 'A', stories: ['S1'], blockedBy: [] },
      { id: 'B', stories: ['S2'], blockedBy: ['A'] },
      { id: 'C', stories: ['S3'], blockedBy: ['A'] },
      { id: 'D', stories: ['S4'], blockedBy: ['B', 'C'] },
    ]),
    failing('A', 'B', 'C', 'D'),
  );
  const d = plan.waves[plan.waves.length - 1][0];
  assert.deepStrictEqual(d, { id: 'D', branch: 'auto/group-D', base: 'main', mergeIn: ['auto/group-B', 'auto/group-C'] });
});

test('--single-pr forces integrated regardless of count', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: [] }]),
    failing('A', 'B'),
    { singlePr: true },
  );
  assert.strictEqual(plan.pr_mode, 'integrated');
});

test('fully-passing groups are excluded from the waves', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: [] }]),
    [{ group: 'A', passes: true }, { group: 'B', passes: false }],
  );
  const ids = plan.waves.flat().map((x) => x.id);
  assert.deepStrictEqual(ids, ['B']);
  assert.strictEqual(plan.pr_mode, 'integrated'); // only one group left to build
});

test('a dependency cycle throws', () => {
  assert.throws(() => planWaves(
    g([{ id: 'A', stories: [], blockedBy: ['B'] }, { id: 'B', stories: [], blockedBy: ['A'] }]),
    failing('A', 'B'),
  ), /cycle/i);
});
