'use strict';

// Pure logic for the continuous drift monitor (gap G2) — the "repeatedly,
// slower cadence" sensor column that the articles place OUTSIDE the change
// lifecycle. Reduce a code-graph to comparable signals, diff against the last
// snapshot, and surface what got WORSE: new import cycles, newly-unstable hubs,
// newly-orphaned (dead-code) files, new dependency CVEs. Reuses the code-map
// orphan definition and the build_graph metrics so each signal has one source
// of truth (harness coherence).

const { findOrphans } = require('../../skills/code-map/scripts/render');

// Same thresholds the coupling report renders with (render.js unstableSection).
const UNSTABLE_FAN_IN = 5;
const UNSTABLE_INSTABILITY = 0.8;

function cycleKey(cycle) {
  return [...cycle].sort().join(' -> ');
}

function unstableHubIds(hubs) {
  return (hubs || [])
    .filter((h) => h.fan_in >= UNSTABLE_FAN_IN && h.instability >= UNSTABLE_INSTABILITY)
    .map((h) => h.id)
    .sort();
}

// Reduce a code-graph to the comparable drift signals.
function extractMetrics(graph) {
  const m = (graph && graph.metrics) || {};
  return {
    files: m.files || 0,
    edges: m.edges || 0,
    cycles: (m.cycles || []).map(cycleKey).sort(),
    unstableHubs: unstableHubIds(m.hubs),
    orphans: graph && graph.nodes ? findOrphans(graph) : [],
    depCves: [],
  };
}

function withDepCves(metrics, keys) {
  return { ...metrics, depCves: [...new Set(keys || [])].sort() };
}

// Design-vs-code drift (gap G4): governed source paths the REASONS Canvas still
// claims but that no longer exist on disk — the design references vanished code.
function withCanvasDrift(metrics, missing) {
  return { ...metrics, canvasDrift: [...new Set(missing || [])].sort() };
}

// When the graph is unavailable this run, keep the prior architecture baseline
// instead of resetting it to zero (which would flag everything as new drift
// once the graph returns). Dependency signals still update.
function carryForwardArch(metrics, prev) {
  if (!prev) return metrics;
  const { files, edges, cycles, unstableHubs, orphans } = prev;
  return { ...metrics, files, edges, cycles, unstableHubs, orphans };
}

function newItems(prev, curr) {
  const prevSet = new Set(prev || []);
  return (curr || []).filter((x) => !prevSet.has(x));
}

function isBaseline(prev) {
  return !prev || Object.keys(prev).length === 0;
}

// What got worse since the last snapshot.
function diffSnapshots(prev, curr) {
  return {
    baseline: isBaseline(prev),
    newCycles: newItems(prev && prev.cycles, curr.cycles),
    newUnstableHubs: newItems(prev && prev.unstableHubs, curr.unstableHubs),
    newOrphans: newItems(prev && prev.orphans, curr.orphans),
    newDepCves: newItems(prev && prev.depCves, curr.depCves),
    newCanvasDrift: newItems(prev && prev.canvasDrift, curr.canvasDrift),
    fileDelta: curr.files - ((prev && prev.files) || 0),
    edgeDelta: curr.edges - ((prev && prev.edges) || 0),
  };
}

function hasRegressed(diff) {
  if (diff.baseline) return false; // a first run is a baseline, never drift
  return diff.newCycles.length > 0 || diff.newUnstableHubs.length > 0 ||
    diff.newOrphans.length > 0 || diff.newDepCves.length > 0 ||
    diff.newCanvasDrift.length > 0;
}

function section(title, items) {
  if (!items.length) return [`### ${title}: none`, ''];
  return [`### ${title}: ${items.length}`, ...items.map((i) => `- ${i}`), ''];
}

function headline(diff) {
  if (diff.baseline) return '_Baseline established — no prior snapshot to diff against._';
  return hasRegressed(diff) ? '**Drift detected.**' : 'No new drift since last snapshot.';
}

function renderDriftReport(diff, curr) {
  return ['# Drift report', '', headline(diff), '']
    .concat(section('New import cycles', diff.newCycles))
    .concat(section('Newly-unstable hubs', diff.newUnstableHubs))
    .concat(section('New dead-code candidates', diff.newOrphans))
    .concat(section('New dependency CVEs', diff.newDepCves))
    .concat(section('New design-vs-code drift (Canvas governs missing files)', diff.newCanvasDrift))
    .concat([`_Totals: ${curr.files} files, ${curr.edges} edges, ${curr.cycles.length} cycles, ` +
      `${curr.orphans.length} orphans, ${curr.depCves.length} dep-alerts, ` +
      `${(curr.canvasDrift || []).length} canvas-drift ` +
      `(Δfiles ${diff.fileDelta}, Δedges ${diff.edgeDelta})._`, ''])
    .join('\n');
}

module.exports = {
  extractMetrics, withDepCves, withCanvasDrift, carryForwardArch, diffSnapshots,
  hasRegressed, renderDriftReport, cycleKey, unstableHubIds,
};
