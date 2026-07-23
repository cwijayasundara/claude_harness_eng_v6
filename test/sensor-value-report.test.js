'use strict';

// The value meter is the subtractive half of the loop: it names controls that never
// fire, never catch anything, or cost more than they are worth. These tests pin the
// classifications a /retro would act on.

const { test } = require('node:test');
const assert = require('node:assert');
const { tally, classify, render } = require('../.claude/scripts/sensor-value-report');

const row = (sensor, over) => ({ sensor, ran: true, blocked: false, ts: 1, ...over });

test('tally aggregates runs, blocks, cost and surfaces per sensor', () => {
  const stats = tally([
    row('a', { elapsed_ms: 10, surface: 'session' }),
    row('a', { elapsed_ms: 30, surface: 'session', blocked: true }),
    row('a', { elapsed_ms: 20, surface: 'integration' }),
  ]);
  const s = stats.get('a');
  assert.strictEqual(s.ran, 3);
  assert.strictEqual(s.blocked, 1);
  assert.deepStrictEqual([...s.surfaces].sort(), ['integration', 'session']);
});

test('a sensor that ran but never blocked is nominated as shelfware', () => {
  const c = classify(tally([row('quiet'), row('quiet'), row('noisy', { blocked: true })]));
  assert.ok(c.neverBlocked.includes('quiet'));
  assert.ok(!c.neverBlocked.includes('noisy'));
});

test('a commit gate absent from the ledger is reported as never fired', () => {
  const c = classify(tally([row('quiet')]));
  assert.ok(c.neverRan.includes('secret-scan'),
    'a catalogued gate with no outcomes must surface as never-fired, not silently vanish');
});

test('a strict-tier gate that never ran is dormant-by-tier, not a retire candidate', () => {
  // security-baseline is strict-only; at standard tier it CORRECTLY never fires.
  // Telling the operator to "check wiring or retire" it would drop a live control.
  const c = classify(tally([row('quiet')]), 'standard');
  assert.ok(c.dormantByTier.includes('security-baseline'),
    'a gate off at the active tier belongs in dormant, not never-fired');
  assert.ok(!c.neverRan.includes('security-baseline'),
    'a tier-dormant gate must not be nominated for retirement');
});

test('an all-tier gate that never ran is still a real never-fired finding', () => {
  const c = classify(tally([row('quiet')]), 'standard');
  assert.ok(c.neverRan.includes('secret-scan'),
    'secret-scan runs at every tier — never-ran here is a genuine wiring finding');
  assert.ok(!c.dormantByTier.includes('secret-scan'));
});

test('without a known tier, nothing is treated as dormant', () => {
  const c = classify(tally([row('quiet')]));
  assert.deepStrictEqual(c.dormantByTier, [],
    'tier splitting is opt-in — synthetic callers keep the tier-blind classification');
  assert.ok(c.neverRan.includes('security-baseline'));
});

test('a sensor present only in the ledger still appears', () => {
  // Session-cadence sensors are not in the commit catalog; widening to the ledger is
  // the whole reason the meter can produce a list in this repo at all.
  const c = classify(tally([row('write-scope', { surface: 'session' })]));
  assert.ok(c.rows.find((r) => r.id === 'write-scope'));
});

test('average cost is reported and slow sensors are flagged', () => {
  const c = classify(tally([
    row('slowpoke', { elapsed_ms: 900 }),
    row('slowpoke', { elapsed_ms: 1100 }),
    row('brisk', { elapsed_ms: 5 }),
  ]));
  assert.strictEqual(c.rows.find((r) => r.id === 'slowpoke').avg_ms, 1000);
  assert.ok(c.slow.some((s) => s.startsWith('slowpoke')));
  assert.ok(!c.slow.some((s) => s.startsWith('brisk')));
});

test('a sensor blocking on most runs is surfaced for review, not auto-judged', () => {
  const c = classify(tally([
    ...Array.from({ length: 6 }, () => row('grumpy', { blocked: true })),
    ...Array.from({ length: 6 }, () => row('calm')),
  ]));
  assert.ok(c.highBlock.some((s) => s.startsWith('grumpy')),
    'the ledger cannot tell a correct block from a wrong one — it must ask a human');
  assert.ok(!c.highBlock.some((s) => s.startsWith('calm')));
});

test('a low-run sensor is not called out for blocking often', () => {
  const c = classify(tally([row('rare', { blocked: true })]));
  assert.deepStrictEqual(c.highBlock, [], 'one block out of one run is not evidence');
});

test('render refuses to produce a cut list below the evidence threshold', () => {
  const out = render([row('a'), row('b')], 20);
  assert.match(out, /INSUFFICIENT DATA/);
  assert.doesNotMatch(out, /candidate shelfware/, 'no nominations without enough data');
});

test('render produces the cut list once the threshold is met', () => {
  const outcomes = Array.from({ length: 25 }, () => row('quiet', { elapsed_ms: 4, surface: 'session' }));
  const out = render(outcomes, 20);
  assert.match(out, /NEVER BLOCKED[^\n]*quiet/);
  assert.match(out, /ran=25 blocked=0 avg=4ms \[session\]/);
});
