const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../.claude/hooks/lib/contract-schema');
const pack = require('../dsl-packs/private-equity/waterfall/pack');

const VALID = {
  waterfall: { fund: 'Fund IV', mode: 'european', hurdle: 'soft' },
  tiers: [
    { tier: 'return_of_capital', to: 'lp', basis: 'contributed_capital' },
    { tier: 'preferred_return', to: 'lp', rate: 0.08, compounding: 'annual', basis: 'contributed_capital' },
    { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 },
    { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
  ]
};

test('schema accepts a valid waterfall', () => {
  assert.deepEqual(validate(pack.schema, VALID), []);
});

test('schema rejects a bad mode enum', () => {
  const bad = JSON.parse(JSON.stringify(VALID));
  bad.waterfall.mode = 'hybrid';
  assert.ok(validate(pack.schema, bad).length > 0);
});

test('schema rejects missing tiers', () => {
  const bad = { waterfall: VALID.waterfall };
  assert.ok(validate(pack.schema, bad).some(e => /tiers/.test(e)));
});

test('meta identifies the pack', () => {
  assert.equal(pack.meta.id, 'pe-waterfall');
  assert.equal(pack.meta.domain, 'private-equity');
});
