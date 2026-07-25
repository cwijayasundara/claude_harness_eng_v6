'use strict';

// Absolute per-token rates, pinned.
//
// These are a REGRESSION PIN, not a design test. The pricing table shipped with
// Opus at $15/$75 per MTok — Claude 3 Opus's retired rate — for long enough that
// every est_cost_usd cap and cost report ran 3x inflated. Nothing caught it: the
// only pricing assertion in budget-state.test.js checks a *ratio* (cache read is
// 10% of input), which holds just as well against wrong absolute numbers.
//
// Rates are asserted through estimateCost (public behaviour) rather than by
// reaching into MODEL_PRICE, so the table and the arithmetic that consumes it are
// round-tripped together. 1M input + 1M output makes the expected dollar figure
// the per-MTok pair added: $5 + $25 = $30.
//
// When Anthropic changes list pricing, update the PER_MTOK table below and the
// docs/model-allocation.md pricing section in the same commit — they are the two
// places a rate is written down.

const assert = require('assert');
const { test } = require('node:test');
const B = require('../.claude/scripts/budget-state.js');

const MTOK = 1e6;

// [input $/MTok, output $/MTok] — Anthropic list rates.
const PER_MTOK = {
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'claude-fable-5': [10, 50],
};

const oneMTokEach = (model) => [{
  kind: 'subagent', agent: 'evaluator', model,
  input_tokens: MTOK, output_tokens: MTOK,
}];

for (const [model, [inRate, outRate]] of Object.entries(PER_MTOK)) {
  test(`${model} prices at $${inRate}/$${outRate} per MTok`, () => {
    const got = B.estimateCost(oneMTokEach(model), 'balanced');
    assert.strictEqual(
      Number(got.toFixed(6)), inRate + outRate,
      `${model}: 1M in + 1M out should cost $${inRate + outRate}, got $${got.toFixed(6)}`
    );
  });
}

// The whole Opus tier is one price. Opus 5 was a drop-in upgrade at Opus 4.8's
// rate, so a future re-pin must not silently make the new model look cheaper (or
// dearer) than the one it replaced in the same cost report.
test('every Opus-tier pin prices identically', () => {
  const opus = Object.keys(PER_MTOK).filter((m) => m.startsWith('claude-opus-'));
  assert.ok(opus.length >= 2, 'expected several Opus pins to compare');
  const costs = opus.map((m) => B.estimateCost(oneMTokEach(m), 'balanced'));
  assert.strictEqual(new Set(costs).size, 1, `Opus pins disagree on price: ${JSON.stringify(costs)}`);
});

// An unknown model must fall back to the Opus tier, not to a stale higher rate —
// an over-priced default silently shrinks every budget cap it is applied to.
test('the default rate matches the Opus tier', () => {
  const unknown = B.estimateCost(oneMTokEach('claude-not-a-real-model'), 'balanced');
  const opus5 = B.estimateCost(oneMTokEach('claude-opus-5'), 'balanced');
  assert.strictEqual(unknown, opus5, 'default fallback must equal the Opus rate');
});

// Ordering invariant: the cost tiers must stay ranked. Catches a transposed pair
// (e.g. Sonnet priced above Opus) that per-model assertions would each still pass
// if both were edited together.
test('cost tiers stay ranked haiku < sonnet < opus < fable', () => {
  const c = (m) => B.estimateCost(oneMTokEach(m), 'balanced');
  assert.ok(c('claude-haiku-4-5') < c('claude-sonnet-5'), 'haiku must be cheaper than sonnet');
  assert.ok(c('claude-sonnet-5') < c('claude-opus-5'), 'sonnet must be cheaper than opus');
  assert.ok(c('claude-opus-5') < c('claude-fable-5'), 'opus must be cheaper than fable');
});

// Cache reads are the dominant token class in a long agentic run; a wrong
// fraction here distorts cost far more than a wrong output rate.
test('cache reads bill at 10% of the input rate', () => {
  const cacheOnly = [{ kind: 'subagent', agent: 'evaluator', model: 'claude-opus-5', cache_read_tokens: MTOK }];
  assert.strictEqual(Number(B.estimateCost(cacheOnly, 'balanced').toFixed(6)), 0.5, '$5 input * 10% = $0.50');
});
