'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const drift = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'drift.js'));

// A graph with one cycle (a<->b), one unstable hub (h), and one orphan (o.py).
function graph() {
  return {
    nodes: [
      { id: 'py:a.py', path: 'a.py' },
      { id: 'py:b.py', path: 'b.py' },
      { id: 'py:h.py', path: 'h.py' },
      { id: 'py:o.py', path: 'o.py' },
    ],
    edges: [
      { source: 'py:a.py', target: 'py:b.py' },
      { source: 'py:b.py', target: 'py:a.py' },
      { source: 'py:a.py', target: 'py:h.py' },
    ],
    metrics: {
      files: 4, edges: 3, cycles: [['py:a.py', 'py:b.py']],
      hubs: [{ id: 'py:h.py', fan_in: 5, fan_out: 0, instability: 0.8 }],
    },
  };
}

test('extractMetrics pulls cycles, unstable hubs, and orphans', () => {
  const m = drift.extractMetrics(graph());
  assert.strictEqual(m.files, 4);
  assert.deepStrictEqual(m.cycles, ['py:a.py -> py:b.py']);
  assert.deepStrictEqual(m.unstableHubs, ['py:h.py']);
  assert.ok(m.orphans.includes('o.py'), 'o.py has no inbound edge → orphan');
  assert.ok(!m.orphans.includes('b.py'), 'b.py is imported → not an orphan');
});

test('unstableHubIds applies the fan_in>=5 && instability>=0.8 threshold', () => {
  assert.deepStrictEqual(drift.unstableHubIds([{ id: 'x', fan_in: 4, instability: 0.9 }]), []);
  assert.deepStrictEqual(drift.unstableHubIds([{ id: 'x', fan_in: 5, instability: 0.7 }]), []);
  assert.deepStrictEqual(drift.unstableHubIds([{ id: 'x', fan_in: 5, instability: 0.8 }]), ['x']);
});

test('first run is a baseline, not a regression', () => {
  const curr = drift.withDepCves(drift.extractMetrics(graph()), []);
  const d = drift.diffSnapshots(null, curr);
  assert.strictEqual(d.baseline, true);
  assert.strictEqual(drift.hasRegressed(d), false, 'baseline must never count as drift');
});

test('a new cycle and a new CVE are flagged as drift', () => {
  const prev = drift.withDepCves(drift.extractMetrics(graph()), ['npm-audit:lodash']);
  const g2 = graph();
  g2.metrics.cycles.push(['py:c.py', 'py:d.py']);
  const curr = drift.withDepCves(drift.extractMetrics(g2), ['npm-audit:lodash', 'pip-audit:CVE-9']);
  const d = drift.diffSnapshots(prev, curr);
  assert.deepStrictEqual(d.newCycles, ['py:c.py -> py:d.py']);
  assert.deepStrictEqual(d.newDepCves, ['pip-audit:CVE-9']);
  assert.strictEqual(drift.hasRegressed(d), true);
});

test('an unchanged graph reports no new drift', () => {
  const prev = drift.withDepCves(drift.extractMetrics(graph()), []);
  const curr = drift.withDepCves(drift.extractMetrics(graph()), []);
  assert.strictEqual(drift.hasRegressed(drift.diffSnapshots(prev, curr)), false);
});

test('carryForwardArch preserves the architecture baseline when the graph is absent', () => {
  const prev = drift.withDepCves(drift.extractMetrics(graph()), []);
  // graphless run: extractMetrics({}) yields zeros; carry-forward restores prev arch
  const empty = drift.extractMetrics({});
  const carried = drift.withDepCves(drift.carryForwardArch(empty, prev), []);
  const d = drift.diffSnapshots(prev, carried);
  assert.strictEqual(drift.hasRegressed(d), false, 'a missing graph must not manufacture drift');
  assert.deepStrictEqual(carried.cycles, prev.cycles);
});

test('a governed path that vanished is flagged as design-vs-code drift (G4)', () => {
  const base = drift.extractMetrics(graph());
  const prev = drift.withCanvasDrift(drift.withDepCves(base, []), []);
  const curr = drift.withCanvasDrift(drift.withDepCves(base, []), ['src/billing/models.py']);
  const d = drift.diffSnapshots(prev, curr);
  assert.deepStrictEqual(d.newCanvasDrift, ['src/billing/models.py']);
  assert.strictEqual(drift.hasRegressed(d), true);
  assert.match(drift.renderDriftReport(d, curr), /design-vs-code drift.*1/s);
});

test('renderDriftReport is legible and reflects regression state', () => {
  const prev = drift.withDepCves(drift.extractMetrics(graph()), []);
  const g2 = graph();
  g2.metrics.cycles.push(['py:c.py', 'py:d.py']);
  const curr = drift.withDepCves(drift.extractMetrics(g2), []);
  const d = drift.diffSnapshots(prev, curr);
  const md = drift.renderDriftReport(d, curr);
  assert.match(md, /# Drift report/);
  assert.match(md, /\*\*Drift detected\.\*\*/);
  assert.match(md, /New import cycles: 1/);
  assert.match(md, /py:c\.py -> py:d\.py/);
});
