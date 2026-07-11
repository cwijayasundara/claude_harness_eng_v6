'use strict';

const assert = require('assert');
const { test } = require('node:test');
const B = require('../.claude/scripts/budget-state.js');

const cfg = (dims, warn) => ({ warn_at_pct: warn || 80, dimensions: dims });

// ---- computeBudget: bands & disablement ---------------------------------

test('computeBudget returns null when there is no usable config', () => {
  assert.strictEqual(B.computeBudget({}, null), null);
  assert.strictEqual(B.computeBudget({}, 'off'), null);
  assert.strictEqual(B.computeBudget({}, { dimensions: [] }), null);
});

test('a run well under every cap is ok with no warn/exhausted', () => {
  const r = B.computeBudget({ wall_clock_ms: 10 * 60000, agents: 20 }, cfg([
    { unit: 'wall_clock_ms', limit: 90 * 60000 },
    { unit: 'agents', limit: 200 },
  ]));
  assert.strictEqual(r.band, 'ok');
  assert.strictEqual(r.exhausted, false);
  assert.strictEqual(r.warn, false);
  assert.strictEqual(r.remaining.agents, 180);
});

test('crossing the warn threshold on any dimension flips the overall band to warn', () => {
  const r = B.computeBudget({ agents: 160 }, cfg([{ unit: 'agents', limit: 200 }])); // 80%
  assert.strictEqual(r.dimensions[0].pctUsed, 80);
  assert.strictEqual(r.band, 'warn');
  assert.strictEqual(r.warn, true);
  assert.strictEqual(r.exhausted, false);
});

test('any single exhausted dimension exhausts the whole budget', () => {
  const r = B.computeBudget({ wall_clock_ms: 5 * 60000, agents: 200 }, cfg([
    { unit: 'wall_clock_ms', limit: 90 * 60000 }, // 5%
    { unit: 'agents', limit: 200 }, // 100%
  ]));
  assert.strictEqual(r.exhausted, true);
  assert.strictEqual(r.band, 'exhausted');
  assert.strictEqual(r.warn, false, 'exhausted takes precedence over warn');
  assert.strictEqual(r.remaining.agents, 0);
});

test('a zero/negative limit is treated as no cap, never instantly exhausted', () => {
  const r = B.computeBudget({ agents: 0 }, cfg([{ unit: 'agents', limit: 0 }]));
  assert.strictEqual(r.dimensions[0].band, 'ok');
  assert.strictEqual(r.exhausted, false);
});

// ---- estimateCost --------------------------------------------------------

const sub = (agent, extra) => ({ kind: 'subagent', agent, ...extra });

test('estimateCost sums per-tier flat rates and ignores non-subagent receipts', () => {
  const receipts = [sub('generator'), sub('evaluator'), { kind: 'prompt' }, { kind: 'tool' }];
  // cost tier: gen 0.04 + judge 0.10 = 0.14
  assert.strictEqual(Math.round(B.estimateCost(receipts, 'cost') * 100) / 100, 0.14);
});

test('estimateCost uses real token counts when a receipt carries them', () => {
  // sonnet: 1000*3e-6 + 2000*15e-6 = 0.003 + 0.030 = 0.033
  const receipts = [sub('generator', { model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 2000 })];
  assert.strictEqual(Math.round(B.estimateCost(receipts, 'cost') * 1000) / 1000, 0.033);
});

test('estimateCost falls back to default rates for an unknown tier', () => {
  assert.strictEqual(Math.round(B.estimateCost([sub('generator')], 'mystery') * 100) / 100, 0.1);
});

test('estimateCost of no receipts is zero', () => {
  assert.strictEqual(B.estimateCost([], 'balanced'), 0);
  assert.strictEqual(B.estimateCost(null, 'balanced'), 0);
});

// ---- gatherSpend ---------------------------------------------------------

test('gatherSpend tallies wall-clock, agent count, and est cost since start', () => {
  const receipts = [
    { kind: 'subagent', agent: 'generator', ts: 1000 },
    { kind: 'subagent', agent: 'evaluator', ts: 2000 },
    { kind: 'subagent', agent: 'generator', ts: 500 }, // before start — excluded
    { kind: 'prompt', ts: 1500 },
  ];
  const spent = B.gatherSpend(receipts, 1000, 1000 + 5 * 60000, 'cost');
  assert.strictEqual(spent.wall_clock_ms, 5 * 60000);
  assert.strictEqual(spent.agents, 2, 'only subagents at/after start');
  assert.strictEqual(spent.est_cost_usd, 0.14);
});

test('gatherSpend never reports negative wall-clock', () => {
  assert.strictEqual(B.gatherSpend([], 5000, 4000, 'cost').wall_clock_ms, 0);
});

// ---- parseBudgetSpec -----------------------------------------------------

test('parseBudgetSpec reads time, agent, and cost specs', () => {
  assert.deepStrictEqual(B.parseBudgetSpec('2h'), { unit: 'wall_clock_ms', limit: 7200000 });
  assert.deepStrictEqual(B.parseBudgetSpec('90m'), { unit: 'wall_clock_ms', limit: 5400000 });
  assert.deepStrictEqual(B.parseBudgetSpec('150agents'), { unit: 'agents', limit: 150 });
  assert.deepStrictEqual(B.parseBudgetSpec('$20'), { unit: 'est_cost_usd', limit: 20, estimated: true });
});

test('parseBudgetSpec returns null to disable and undefined on garbage', () => {
  assert.strictEqual(B.parseBudgetSpec('off'), null);
  assert.strictEqual(B.parseBudgetSpec('none'), null);
  assert.strictEqual(B.parseBudgetSpec('banana'), undefined);
  assert.strictEqual(B.parseBudgetSpec(null), undefined);
});

// ---- defaultBudget -------------------------------------------------------

test('defaultBudget yields the three-dimension cap for a tier', () => {
  const d = B.defaultBudget('cost');
  assert.strictEqual(d.warn_at_pct, B.DEFAULT_WARN_PCT);
  assert.strictEqual(d.dimensions.length, 3);
  assert.deepStrictEqual(d.dimensions[0], { unit: 'wall_clock_ms', limit: 30 * 60000 });
  assert.strictEqual(d.dimensions[2].estimated, true);
});

test('defaultBudget falls back to balanced for an unknown tier', () => {
  assert.deepStrictEqual(B.defaultBudget('mystery'), B.defaultBudget('balanced'));
});

// ---- end to end ----------------------------------------------------------

test('gatherSpend output feeds computeBudget to a verdict', () => {
  const receipts = Array.from({ length: 80 }, (_, i) => ({ kind: 'subagent', agent: 'generator', ts: 10 + i }));
  const spent = B.gatherSpend(receipts, 0, 31 * 60000, 'cost'); // 31m wall, 80 agents
  const r = B.computeBudget(spent, B.defaultBudget('cost')); // caps: 30m, 80 agents, $8
  assert.strictEqual(r.exhausted, true, 'both wall-clock and agent caps reached');
  assert.strictEqual(r.band, 'exhausted');
});

// ---- receiptCost / modelMix / costSource / fmtCost -------------------------

test('receiptCost prices cache read at 10% of input rate', () => {
  // sonnet input 3e-6: 1000 cache_read * 0.1 * 3e-6 = 0.0003
  const c = B.receiptCost({
    kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5',
    cache_read_tokens: 1000,
  }, 'cost');
  assert.strictEqual(Math.round(c * 1e6) / 1e6, 0.0003);
});

test('modelMix groups subagents by model', () => {
  const receipts = [
    { kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5' },
    { kind: 'subagent', agent: 'evaluator', model: 'claude-opus-4-8' },
    { kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5' },
    { kind: 'prompt' },
  ];
  const mix = B.modelMix(receipts, 'cost');
  assert.strictEqual(mix['claude-sonnet-5'].agents, 2);
  assert.strictEqual(mix['claude-opus-4-8'].agents, 1);
});

test('costSource is estimate | receipts | mixed', () => {
  assert.strictEqual(B.costSource([{ kind: 'subagent', agent: 'generator' }]), 'estimate');
  assert.strictEqual(B.costSource([{
    kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5',
    input_tokens: 10, output_tokens: 5,
  }]), 'receipts');
  assert.strictEqual(B.costSource([
    { kind: 'subagent', agent: 'generator' },
    { kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5', input_tokens: 1 },
  ]), 'mixed');
});

test('fmtCost renders source and model mix', () => {
  const line = B.fmtCost({
    est_cost_usd: 0.14,
    source: 'estimate',
    worker_pct: 29,
    model_mix: {
      'claude-sonnet-5': { agents: 1, est_cost_usd: 0.04 },
      'claude-opus-4-8': { agents: 1, est_cost_usd: 0.1 },
    },
  });
  assert.match(line, /Cost:/);
  assert.match(line, /source=estimate/);
  assert.match(line, /worker 29%/);
  assert.match(line, /sonnet-5=1/);
});
