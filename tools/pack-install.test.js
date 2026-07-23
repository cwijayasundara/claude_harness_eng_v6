'use strict';

// Materializing an install from the partition is what turns "kernel = 18% of units"
// from a measurement into a deliverable. These tests pin the selection rules; the
// smoke test that a kernel-only tree actually RUNS lives in pack-install-smoke.test.js.

const test = require('node:test');
const assert = require('node:assert');
const { resolveSelection, filesFor } = require('./pack-install');

const PARTITION = {
  kernel: { skill: ['vibe', 'change'], agent: ['implementer'], lib: ['common'], script: ['review-tier'] },
  packs: {
    planning: { skill: ['design'], agent: ['planner'], script: ['wave-plan'], lib: ['canvas'] },
    brownfield: { skill: ['code-map'], script: ['nav-query'], lib: [], agent: [] },
  },
};

test('kernel-only selection contains the kernel and nothing else', () => {
  const sel = resolveSelection(PARTITION, []);
  assert.deepStrictEqual(sel.skill.sort(), ['change', 'vibe']);
  assert.ok(!sel.skill.includes('design'), 'a pack skill must not appear in a kernel-only install');
  assert.ok(!sel.script.includes('nav-query'));
});

test('selecting a pack adds exactly that pack on top of the kernel', () => {
  const sel = resolveSelection(PARTITION, ['planning']);
  assert.deepStrictEqual(sel.skill.sort(), ['change', 'design', 'vibe']);
  assert.deepStrictEqual(sel.agent.sort(), ['implementer', 'planner']);
  assert.ok(!sel.skill.includes('code-map'), 'an unselected pack must stay out');
});

test('the kernel is always included, even if not named', () => {
  const sel = resolveSelection(PARTITION, ['brownfield']);
  assert.ok(sel.skill.includes('vibe'), 'the kernel is not optional');
});

test('selecting every pack yields every unit in the partition', () => {
  const sel = resolveSelection(PARTITION, ['planning', 'brownfield']);
  const total = Object.values(sel).reduce((a, l) => a + l.length, 0);
  const declared = ['kernel', ...Object.keys(PARTITION.packs)].reduce((a, name) => {
    const spec = name === 'kernel' ? PARTITION.kernel : PARTITION.packs[name];
    return a + Object.values(spec).reduce((b, l) => b + l.length, 0);
  }, 0);
  assert.strictEqual(total, declared);
});

test('an unknown pack name is rejected rather than silently ignored', () => {
  assert.throws(() => resolveSelection(PARTITION, ['nope']), /unknown pack/i,
    'a typo must not silently produce a smaller install than asked for');
});

test('selection is deduplicated and stable', () => {
  const a = resolveSelection(PARTITION, ['planning', 'planning']);
  const b = resolveSelection(PARTITION, ['planning']);
  assert.deepStrictEqual(a, b);
});

test('filesFor maps unit kinds to their on-disk paths', () => {
  const files = filesFor({ skill: ['vibe'], lib: ['common'], script: ['review-tier'], agent: ['implementer'], hook: [], githook: [] });
  assert.ok(files.some((f) => f === '.claude/skills/vibe'));
  assert.ok(files.some((f) => f === '.claude/hooks/lib/common.js'));
  assert.ok(files.some((f) => f === '.claude/scripts/review-tier.js'));
  assert.ok(files.some((f) => f === '.claude/agents/implementer.md'));
});

test('filesFor refuses an unknown kind rather than dropping it', () => {
  assert.throws(() => filesFor({ widget: ['x'] }), /unknown unit kind/i,
    'silently dropping a kind would produce an install missing files nobody noticed');
});
