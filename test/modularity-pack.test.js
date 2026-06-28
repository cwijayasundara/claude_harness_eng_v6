'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const mp = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'modularity-pack.js'));

// a.py and b.py both import the same two helpers (duplication candidate);
// schema.py is a high-fan-in hub but legitimate by name; god.py is a suspicious hub.
function graph() {
  return {
    nodes: [
      { id: 'py:a.py', path: 'a.py' }, { id: 'py:b.py', path: 'b.py' },
      { id: 'py:x.py', path: 'x.py' }, { id: 'py:y.py', path: 'y.py' },
      { id: 'py:schema.py', path: 'domain/schema.py' }, { id: 'py:god.py', path: 'services/god.py' },
    ],
    edges: [
      { source: 'py:a.py', target: 'py:x.py' }, { source: 'py:a.py', target: 'py:y.py' },
      { source: 'py:b.py', target: 'py:x.py' }, { source: 'py:b.py', target: 'py:y.py' },
      { source: 'py:a.py', target: 'ext:os' }, // external excluded
    ],
    metrics: {
      cycles: [['py:m.py', 'py:n.py']],
      hubs: [
        { id: 'py:schema.py', fan_in: 8, fan_out: 0, instability: 0 },
        { id: 'py:god.py', fan_in: 6, fan_out: 9, instability: 0.9 },
        { id: 'py:x.py', fan_in: 2, fan_out: 0, instability: 0 }, // below hub threshold
      ],
    },
  };
}

test('isLikelyLegitHub recognizes factories/schemas/utils, not arbitrary services', () => {
  assert.ok(mp.isLikelyLegitHub('domain/schema.py'));
  assert.ok(mp.isLikelyLegitHub('src/user_factory.ts'));
  assert.ok(mp.isLikelyLegitHub('lib/utils/index.js'));
  assert.ok(!mp.isLikelyLegitHub('services/billing.py'));
});

test('hubEvidence keeps fan-in>=5 and pre-classifies legitimacy + instability', () => {
  const hubs = mp.hubEvidence(graph());
  const ids = hubs.map((h) => h.id).sort();
  assert.deepStrictEqual(ids, ['py:god.py', 'py:schema.py'], 'x.py is below the hub threshold');
  const schema = hubs.find((h) => h.id === 'py:schema.py');
  const god = hubs.find((h) => h.id === 'py:god.py');
  assert.strictEqual(schema.likelyLegit, true);
  assert.strictEqual(god.likelyLegit, false);
  assert.strictEqual(god.unstable, true);
  assert.strictEqual(schema.unstable, false);
});

test('duplicationCandidates groups files with identical (>=2) import sets, excluding ext', () => {
  const cands = mp.duplicationCandidates(graph());
  assert.strictEqual(cands.length, 1);
  assert.deepStrictEqual(cands[0], ['a.py', 'b.py']);
});

test('buildPack + renderBrief produce a grounded, legible brief', () => {
  const pack = mp.buildPack(graph());
  assert.strictEqual(pack.hubs.length, 2);
  assert.strictEqual(pack.cycles.length, 1);
  const brief = mp.renderBrief(pack);
  assert.match(brief, /Modularity review pack/);
  assert.match(brief, /likely-legitimate/);
  assert.match(brief, /a\.py.*b\.py|`a\.py`, `b\.py`/);
  assert.match(brief, /py:m\.py -> py:n\.py/);
});
