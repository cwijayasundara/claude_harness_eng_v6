const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, validate } = require('../dsl-packs/private-equity/waterfall/pack');

function irFrom(tiers, header = {}) {
  return compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'soft', ...header }, tiers });
}
const T = {
  roc: { tier: 'return_of_capital', to: 'lp' },
  pref: { tier: 'preferred_return', to: 'lp', rate: 0.08 },
  catchup: (tc = 0.20) => ({ tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: tc }),
  carry: (gp = 0.20, above) => ({ tier: 'carried_interest', split: { gp, lp: 1 - gp }, ...(above !== undefined ? { above } : {}) })
};
const errs = (ir) => validate(ir).filter(f => f.severity === 'error');

test('valid soft waterfall has no errors', () => {
  assert.deepEqual(errs(irFrom([T.roc, T.pref, T.catchup(), T.carry()])), []);
});
test('R1 tier order: carry before catchup', () => {
  const f = errs(irFrom([T.roc, T.pref, T.carry(), T.catchup()]));
  assert.ok(f.some(e => e.rule === 'R1' && /catch-up/.test(e.message)));
});
test('R2 catchup target != base carry gp', () => {
  const f = errs(irFrom([T.roc, T.pref, T.catchup(0.20), T.carry(0.25)]));
  assert.ok(f.some(e => e.rule === 'R2' && /catch up to a carry it never earns/.test(e.message)));
});
test('R3 hard hurdle forbids catchup', () => {
  const f = errs(irFrom([T.roc, T.pref, T.catchup(), T.carry()], { hurdle: 'hard' }));
  assert.ok(f.some(e => e.rule === 'R3' && /hard/.test(e.message)));
});
test('R3 soft hurdle requires catchup', () => {
  const f = errs(irFrom([T.roc, T.pref, T.carry()], { hurdle: 'soft' }));
  assert.ok(f.some(e => e.rule === 'R3' && /catch up/.test(e.message)));
});
test('R4 split must sum to 1', () => {
  const ir = irFrom([T.roc, T.pref, T.catchup(), T.carry()]);
  ir.tiers[3].lpSplit = 0.75; // 0.20 + 0.75 = 0.95
  assert.ok(errs(ir).some(e => e.rule === 'R4'));
});
test('R5 multi-tier carry gates must ascend', () => {
  const f = errs(irFrom([T.roc, T.pref, T.catchup(), T.carry(0.20), T.carry(0.25, 2.5), T.carry(0.30, 2.0)]));
  assert.ok(f.some(e => e.rule === 'R5'));
});
test('R6 out-of-range pref rate errors; carry>0.30 warns', () => {
  const ir = irFrom([T.roc, { tier: 'preferred_return', to: 'lp', rate: 0.8 }, T.catchup(), T.carry()]);
  assert.ok(errs(ir).some(e => e.rule === 'R6'));
  const warn = validate(irFrom([T.roc, T.pref, T.catchup(0.35), T.carry(0.35)])).filter(f => f.severity === 'warn');
  assert.ok(warn.some(e => e.rule === 'R6'));
});
test('R7 american without clawback warns', () => {
  const ir = compile({ waterfall: { fund: 'F', mode: 'american', hurdle: 'soft', clawback: false },
    tiers: [T.roc, T.pref, T.catchup(), T.carry()] });
  assert.ok(validate(ir).some(e => e.rule === 'R7' && e.severity === 'warn'));
});
test('R8 return_of_capital must be present as tier 1', () => {
  const f = errs(irFrom([T.pref, T.catchup(), T.carry()]));
  assert.ok(f.some(e => e.rule === 'R8'));
});
