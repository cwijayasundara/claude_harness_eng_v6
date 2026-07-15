'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildReport, fmtReport, inferTier, costPerPassed, CAVEATS,
} = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'cost-per-outcome.js'));

// Build a throwaway project root with an optional features.json + runs receipts.
function mkRoot(features, receipts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-per-outcome-'));
  fs.mkdirSync(path.join(root, '.claude', 'runs'), { recursive: true });
  if (features) fs.writeFileSync(path.join(root, 'features.json'), JSON.stringify(features));
  if (receipts) {
    fs.writeFileSync(
      path.join(root, '.claude', 'runs', 'r.jsonl'),
      `${receipts.map((x) => JSON.stringify(x)).join('\n')}\n`,
    );
  }
  return root;
}

const sub = (group, extra = {}) => ({
  kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5', group_id: group, ...extra,
});
// Token-bearing receipt: priced by MODEL_PRICE, so cost is tier-independent.
const tok = (group, model, input, output) => ({
  kind: 'subagent', agent: 'generator', model, group_id: group, input_tokens: input, output_tokens: output,
});

// --- costPerPassed (divide-by-zero guard) ----------------------------------

test('costPerPassed: divides, and returns n/a (never NaN/Infinity) at zero passed', () => {
  assert.strictEqual(costPerPassed(3, 2), 1.5);
  assert.strictEqual(costPerPassed(3, 0), 'n/a');
  assert.strictEqual(costPerPassed(0, 0), 'n/a');
});

// --- buildReport: the join + run total -------------------------------------

test('buildReport: joins cost-by-group to passed-by-group and computes cost/passed', () => {
  const root = mkRoot(
    [
      { id: 'F1', group: 'G1', story: 'S1', passes: true },
      { id: 'F2', group: 'G1', story: 'S2', passes: false },
      { id: 'F3', group: 'G2', story: 'S3', passes: true },
    ],
    [tok('G1', 'claude-sonnet-5', 1000, 500), tok('G2', 'claude-sonnet-5', 2000, 800)],
  );
  const rep = buildReport(root);
  assert.strictEqual(rep.status, 'ok');
  // Run total: 2 of 3 features passed; cost/passed is a positive number.
  assert.strictEqual(rep.run_total.passed, 2);
  assert.strictEqual(rep.run_total.total, 3);
  // Pin the deterministic numbers so a rounding / MODEL_PRICE / pricing-tier
  // regression fails loudly instead of sliding under a loose `> 0`.
  assert.strictEqual(rep.run_total.est_cost_usd, 0.03); // 0.0105 (G1) + 0.018 (G2)
  assert.strictEqual(rep.run_total.cost_per_passed_story, 0.02); // 0.03 / 2 passed
  // Per-group join is keyed on group_id <-> group.
  const byGroup = Object.fromEntries(rep.by_group.map((g) => [g.group, g]));
  assert.strictEqual(byGroup.G1.passed, 1);
  assert.strictEqual(byGroup.G1.total, 2);
  assert.strictEqual(byGroup.G2.passed, 1);
  assert.strictEqual(byGroup.G1.est_cost_usd, 0.01);
  assert.strictEqual(byGroup.G2.est_cost_usd, 0.02); // G2 burned more tokens
});

test('buildReport: token-less receipts price by the (inferred) tier rate-seed', () => {
  // sub() carries no token fields, so receiptCost falls back to RATE_USD, not
  // MODEL_PRICE. A sonnet-5 generator infers 'balanced' -> gen rate-seed 0.10.
  const root = mkRoot([{ id: 'F1', group: 'G1', passes: true }], [sub('G1')]);
  const rep = buildReport(root);
  assert.strictEqual(rep.tier.label, 'balanced');
  assert.strictEqual(rep.run_total.est_cost_usd, 0.1);
  assert.strictEqual(rep.run_total.cost_per_passed_story, 0.1);
});

test('buildReport: a group with cost but zero passing reports n/a, not a crash', () => {
  const root = mkRoot(
    [{ id: 'F1', group: 'G1', passes: false }],
    [tok('G1', 'claude-sonnet-5', 1000, 500)],
  );
  const rep = buildReport(root);
  assert.strictEqual(rep.run_total.cost_per_passed_story, 'n/a');
  assert.strictEqual(rep.by_group[0].cost_per_passed_story, 'n/a');
  assert.ok(rep.by_group[0].est_cost_usd > 0); // cost is still surfaced
});

test('buildReport: unions groups present on only one side of the join', () => {
  const root = mkRoot(
    [{ id: 'F1', group: 'FEAT-ONLY', passes: true }],
    [sub('COST-ONLY')],
  );
  const groups = buildReport(root).by_group.map((g) => g.group);
  assert.ok(groups.includes('FEAT-ONLY')); // in features, no receipts
  assert.ok(groups.includes('COST-ONLY')); // in receipts, no features
});

// --- buildReport: empty / degraded states (never vacuously "ok") -----------

test('buildReport: reports distinct statuses for no-data / no-runs / no-features', () => {
  assert.strictEqual(buildReport(mkRoot(null, null)).status, 'no-data');
  assert.strictEqual(
    buildReport(mkRoot([{ id: 'F1', group: 'G1', passes: true }], null)).status,
    'no-runs',
  );
  assert.strictEqual(buildReport(mkRoot(null, [sub('G1')])).status, 'no-features');
});

// --- inferTier: reverse-inference from the recorded model mix --------------

test('inferTier: distinguishes cost (haiku) / max-quality (opus gen) / balanced (sonnet gen)', () => {
  assert.strictEqual(
    inferTier([sub('G1', { agent: 'codebase-explorer', model: 'claude-haiku-4-5' })]).label,
    'cost',
  );
  assert.strictEqual(inferTier([sub('G1', { model: 'claude-opus-4-8' })]).label, 'max-quality');
  assert.strictEqual(inferTier([sub('G1', { model: 'claude-sonnet-5' })]).label, 'balanced');
  assert.strictEqual(inferTier([]).label, 'unknown');
});

// --- report shape: caveats + rendering -------------------------------------

test('buildReport: carries both honest caveats; tier is marked inferred', () => {
  const rep = buildReport(mkRoot(null, [sub('G1')]));
  assert.strictEqual(rep.caveats.length, 2);
  assert.deepStrictEqual(rep.caveats, [...CAVEATS]);
  assert.strictEqual(rep.tier.inferred, true);
  assert.match(rep.caveats.join(' '), /per-GROUP/);
  assert.match(rep.caveats.join(' '), /INFERRED/);
});

test('fmtReport: renders the run-total line, the caveats, and the empty status hint', () => {
  const md = fmtReport(buildReport(mkRoot(null, null)));
  assert.match(md, /Cost-per-passed-story/);
  assert.match(md, /nothing to benchmark yet/); // no-data status hint
  assert.match(md, /Caveats:/);
});
