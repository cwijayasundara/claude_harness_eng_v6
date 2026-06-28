'use strict';

// Cycle-fail ratchet (gap G8 completion). Import cycles are reported by code-map
// and flagged as drift by the monitor, but never block. This makes the cycle
// count a monotonic ratchet — like coverage, it may only move the right way: a
// change may not ADD an import cycle. Reads the code-graph (kept fresh by
// graph-refresh / code-map); pure logic here, IO in scripts/cycle-gate.js.

function cycleKeys(graph) {
  const cycles = (((graph && graph.metrics) || {}).cycles) || [];
  return cycles.map((c) => [...c].sort().join(' -> ')).sort();
}

// baseline is the lowest cycle count achieved so far. count > baseline blocks;
// count <= baseline ratchets the baseline down. A first run (no baseline)
// establishes it without blocking.
function gateDecision(keys, baseline) {
  const count = keys.length;
  const hasBaseline = Number.isFinite(baseline);
  return {
    count,
    baseline: hasBaseline ? baseline : count,
    blocked: hasBaseline && count > baseline,
    newBaseline: hasBaseline ? Math.min(count, baseline) : count,
    baselineRun: !hasBaseline,
  };
}

module.exports = { cycleKeys, gateDecision };
