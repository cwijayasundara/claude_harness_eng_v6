'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { GATE_CATALOG, selectGates } = require('../.claude/hooks/lib/gate-registry');
const { GATE_TIERS } = require('../.claude/hooks/lib/sensor-tier');

// The v6 partition rule, enforced at runtime rather than only by tools/check-partition.js:
// gates-early and gates-quality are kernel; every other gate module belongs to a pack and
// must not be pulled into the process merely by loading the registry. If this regresses,
// an uninstalled pack breaks the commit gate for everyone.
test('loading the registry does not eagerly require any pack gate module', () => {
  const loaded = Object.keys(require.cache).map((p) => p.replace(/\\/g, '/'));
  for (const packModule of ['gates-legacy', 'gates-strict', 'gates-live-externals']) {
    assert.ok(
      !loaded.some((p) => p.includes(`/hooks/lib/${packModule}.js`)),
      `${packModule}.js was eagerly loaded — it belongs to a pack and must be lazy (packRun)`
    );
  }
});

test('every pack-owned gate is wired through a lazy runner, not a direct reference', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', '.claude', 'hooks', 'lib', 'gate-registry.js'), 'utf8'
  );
  // A top-level require of a pack module defeats the laziness above.
  for (const packModule of ['gates-legacy', 'gates-strict', 'gates-live-externals']) {
    assert.doesNotMatch(
      src,
      new RegExp(`^const .*require\\(['"]\\./${packModule}['"]\\)`, 'm'),
      `${packModule} must not be required at module scope`
    );
  }
  assert.match(src, /function packRun\(/, 'the lazy runner must exist');
});

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

test('duplication-ratchet is registered in the GATE_CATALOG at strict tier', () => {
  const entry = GATE_CATALOG.find((g) => g.id === 'duplication-ratchet');
  assert.ok(entry, 'duplication-ratchet must be in the catalog');
  assert.strictEqual(entry.runsWithoutSource, false);
  assert.strictEqual(typeof entry.run, 'function');
  assert.ok(GATE_TIERS['duplication-ratchet'].has('strict'));
});

test('withoutSourceOnly returns only docs-safe gates', () => {
  const ids = selectGates('standard', { withoutSourceOnly: true }).map((g) => g.id);
  assert.deepStrictEqual(ids, [
    'secret-scan',
    'amendment-provenance',
    'test-deletion-guard',
    'stub-smell-gate',
    'live-externals',
  ]);
});

test('minimal withoutSourceOnly drops test-deletion and stub-smell', () => {
  const ids = selectGates('minimal', { withoutSourceOnly: true }).map((g) => g.id);
  assert.deepStrictEqual(ids, ['secret-scan', 'amendment-provenance']);
});
