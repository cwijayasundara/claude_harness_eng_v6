'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { GATE_CATALOG, selectGates } = require('../.claude/hooks/lib/gate-registry');

test('GATE_CATALOG is ordered and has unique ids', () => {
  const ids = GATE_CATALOG.map((g) => g.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (let i = 1; i < GATE_CATALOG.length; i++) {
    assert.ok(GATE_CATALOG[i].order >= GATE_CATALOG[i - 1].order);
  }
});

test('standard selects the historical set (includes sprout, excludes cycle)', () => {
  const ids = selectGates('standard').map((g) => g.id);
  assert.ok(ids.includes('secret-scan'));
  assert.ok(ids.includes('sprout-diff'));
  assert.ok(ids.includes('legacy-discipline-proof'));
  assert.ok(ids.includes('mutation-smoke'));
  assert.ok(!ids.includes('cycle-detection'));
  assert.ok(!ids.includes('coupling-ratchet'));
});

test('minimal drops ceremony gates', () => {
  const ids = selectGates('minimal').map((g) => g.id);
  assert.ok(ids.includes('secret-scan'));
  assert.ok(ids.includes('layer-imports'));
  assert.ok(!ids.includes('legacy-discipline-proof'));
  assert.ok(!ids.includes('sprout-diff'));
  assert.ok(!ids.includes('at-first-gate'));
  assert.ok(!ids.includes('coverage-ratchet-py'));
  assert.ok(!ids.includes('mutation-smoke'));
  assert.ok(!ids.includes('test-deletion-guard'));
});

test('strict adds architecture ratchets', () => {
  const ids = selectGates('strict').map((g) => g.id);
  assert.ok(ids.includes('sprout-diff'));
  assert.ok(ids.includes('cycle-detection'));
  assert.ok(ids.includes('coupling-ratchet'));
});

test('withoutSourceOnly returns only docs-safe gates', () => {
  const ids = selectGates('standard', { withoutSourceOnly: true }).map((g) => g.id);
  assert.deepStrictEqual(ids, [
    'secret-scan',
    'amendment-provenance',
    'test-deletion-guard',
    'stub-smell-gate',
  ]);
});

test('minimal withoutSourceOnly drops test-deletion and stub-smell', () => {
  const ids = selectGates('minimal', { withoutSourceOnly: true }).map((g) => g.id);
  assert.deepStrictEqual(ids, ['secret-scan', 'amendment-provenance']);
});
