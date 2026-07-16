// test/pe-waterfall-compile.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile } = require('../dsl-packs/private-equity/waterfall/pack');

const SURFACE = {
  waterfall: { fund: 'Fund IV', mode: 'american', hurdle: 'soft' },
  tiers: [
    { tier: 'return_of_capital', to: 'lp' },
    { tier: 'preferred_return', to: 'lp', rate: 0.08 },
    { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 },
    { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
  ]
};

test('compile resolves clawback default from american mode', () => {
  assert.equal(compile(SURFACE).clawback, true);
});

test('compile defaults basis and compounding', () => {
  const ir = compile(SURFACE);
  assert.equal(ir.tiers[0].basis, 'contributed_capital');
  assert.equal(ir.tiers[1].compounding, 'annual');
});

test('compile maps tiers to ops with base carry aboveMoic null', () => {
  const ir = compile(SURFACE);
  assert.deepEqual(ir.tiers.map(t => t.op), ['roc', 'pref', 'catchup', 'carry']);
  assert.equal(ir.tiers[3].aboveMoic, null);
  assert.equal(ir.tiers[3].gpSplit, 0.20);
});

test('compile keeps explicit clawback and european default false', () => {
  const eur = compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'hard' },
    tiers: [{ tier: 'return_of_capital', to: 'lp' }, { tier: 'preferred_return', to: 'lp', rate: 0.08 },
            { tier: 'carried_interest', split: { gp: 0.2, lp: 0.8 } }] });
  assert.equal(eur.clawback, false);
});
