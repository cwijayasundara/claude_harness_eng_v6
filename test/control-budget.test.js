'use strict';

// P0 subtractive ratchet (harness-simplification): the harness ratchets product
// code quality one way (better) but never ratcheted its OWN control count, so a
// documented cut-to-half cleanup (2026-06-10) was overwhelmed by accretion in
// five weeks. This gate makes control COUNT a monotonic ratchet, the same shape
// as cycle-gate/coupling-gate: the count may only stay flat or drop unless each
// newly-added control carries a written net_add_justification.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const {
  controlIds,
  justifiedIds,
  budgetDecision,
} = require(path.join(REPO_ROOT, '.claude', 'hooks', 'lib', 'control-budget.js'));

const BASELINE_PATH = path.join(REPO_ROOT, '.claude', 'state', 'control-budget-baseline.json');
const MANIFEST_PATH = path.join(REPO_ROOT, 'harness-manifest.json');

function base(ids) {
  return { count: ids.length, ids: [...ids].sort() };
}

test('controlIds: non-planned guides+sensors, sorted, planned excluded', () => {
  const m = {
    guides: [{ id: 'g1' }, { id: 'g2', status: 'planned', gap_ref: 'G99' }],
    sensors: [{ id: 's2' }, { id: 's1', status: 'partial' }],
  };
  assert.deepStrictEqual(controlIds(m), ['g1', 's1', 's2']);
});

test('justifiedIds: only entries with a non-empty net_add_justification', () => {
  const m = {
    guides: [{ id: 'g1', net_add_justification: 'closes G40' }, { id: 'g2', net_add_justification: '' }],
    sensors: [{ id: 's1' }],
  };
  assert.deepStrictEqual(justifiedIds(m).sort(), ['g1']);
});

test('first run establishes the baseline without blocking', () => {
  const d = budgetDecision(['a', 'b'], undefined, []);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.baselineRun, true);
  assert.deepStrictEqual(d.newBaseline.ids, ['a', 'b']);
});

test('flat count (same ids) passes and does not block', () => {
  const d = budgetDecision(['a', 'b'], base(['a', 'b']), []);
  assert.strictEqual(d.blocked, false);
  assert.deepStrictEqual(d.newBaseline.ids, ['a', 'b']);
});

test('removal ratchets the baseline down', () => {
  const d = budgetDecision(['a'], base(['a', 'b', 'c']), []);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.newBaseline.count, 1);
});

test('a swap that keeps the count flat needs no justification (replace, not grow)', () => {
  // remove c, add d -> count unchanged; doctrine = "replace one OR justify"
  const d = budgetDecision(['a', 'b', 'd'], base(['a', 'b', 'c']), []);
  assert.strictEqual(d.blocked, false);
  assert.deepStrictEqual(d.newBaseline.ids, ['a', 'b', 'd']);
});

test('unjustified net growth BLOCKS and names the offending additions', () => {
  const d = budgetDecision(['a', 'b', 'c'], base(['a', 'b']), []);
  assert.strictEqual(d.blocked, true);
  assert.deepStrictEqual(d.unjustified, ['c']);
  // baseline is NOT advanced on a block
  assert.strictEqual(d.newBaseline.count, 2);
});

test('justified net growth passes and advances the baseline', () => {
  const d = budgetDecision(['a', 'b', 'c'], base(['a', 'b']), ['c']);
  assert.strictEqual(d.blocked, false);
  assert.deepStrictEqual(d.unjustified, []);
  assert.strictEqual(d.newBaseline.count, 3);
});

test('mixed grow: only the UNjustified additions block', () => {
  const d = budgetDecision(['a', 'b', 'c', 'd'], base(['a', 'b']), ['c']);
  assert.strictEqual(d.blocked, true);
  assert.deepStrictEqual(d.unjustified, ['d']);
});

// Integration: the committed real tree must not be in violation, and the
// committed baseline must match the manifest — this is the friction surface.
// Adding a control to the manifest without updating the baseline fails here.
test('committed baseline is consistent with the real manifest (not in violation)', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const d = budgetDecision(controlIds(manifest), baseline, justifiedIds(manifest));
  assert.strictEqual(d.blocked, false, `control budget is BLOCKED: unjustified additions ${JSON.stringify(d.unjustified)} — run \`npm run control-budget\` after removing a control or adding net_add_justification`);
  assert.strictEqual(
    controlIds(manifest).length, baseline.count,
    'baseline count drifted from the manifest — run `npm run control-budget` to re-ratchet',
  );
});
