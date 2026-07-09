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

// Gap G26: `graph.metrics.hubs` is truncated to the top 25 by fan-in for the
// human-facing coupling report (graph_metrics.py's _hubs()) — a reasonable
// display cap on its own terms, but every unstable-hub CHECK in this file and
// its downstream consumers (coupling-gate.js, agent-readiness-project.js,
// record-modularity-review.js) was reusing that same truncated list, so a
// real unstable hub ranked 26th+ by fan-in was structurally invisible to all
// of them. graph_metrics.py now also emits `metrics.unstable_hubs`: the FULL,
// uncapped hub list already filtered by these same thresholds — when present
// its entries just need their ids extracted, no further filtering. When
// absent (an older graph, or a non-Python producer that never gained this
// field), fall back to the existing capped-`hubs` + unstableHubIds path
// unchanged, so every pre-G26 fixture graph keeps working exactly as before.
function hubsForStabilityCheck(graph) {
  const m = (graph && graph.metrics) || {};
  return m.unstable_hubs
    ? m.unstable_hubs.map((h) => h.id).sort()
    : unstableHubIds(m.hubs);
}

// Reduce a code-graph to the comparable drift signals.
function extractMetrics(graph) {
  const m = (graph && graph.metrics) || {};
  return {
    files: m.files || 0,
    edges: m.edges || 0,
    cycles: (m.cycles || []).map(cycleKey).sort(),
    unstableHubs: hubsForStabilityCheck(graph),
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

// Modularity-review staleness (gap G19): the deterministic proxy for "the
// expensive inferential modularity review is overdue," not a substitute for
// it. markerHubIds is the unstable-hub set recorded by
// record-modularity-review.js the last time a REAL review ran (/brownfield
// --full's Step 3.6, or /design --delta's Step D3.5); currentHubIds is the
// live code-graph's unstable-hub set for this drift run. A hub unstable now
// but absent from the marker snapshot has drifted since that review last
// looked at it. No marker at all (a project where no real review has ever
// run) means markerHubIds is null/undefined, which newItems already treats
// as an empty set — so every currently unstable hub counts as stale, the
// same "no baseline = first-run signal, not a silent pass" discipline
// cycle-gate.js/coupling-gate.js apply to their own ratchets.
function withModularityStaleness(metrics, markerHubIds, currentHubIds) {
  return { ...metrics, modularityStaleHubs: newItems(markerHubIds, currentHubIds).sort() };
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
    newModularityStaleHubs: newItems(prev && prev.modularityStaleHubs, curr.modularityStaleHubs),
    fileDelta: curr.files - ((prev && prev.files) || 0),
    edgeDelta: curr.edges - ((prev && prev.edges) || 0),
  };
}

function hasRegressed(diff) {
  if (diff.baseline) return false; // a first run is a baseline, never drift
  return diff.newCycles.length > 0 || diff.newUnstableHubs.length > 0 ||
    diff.newOrphans.length > 0 || diff.newDepCves.length > 0 ||
    diff.newCanvasDrift.length > 0 || diff.newModularityStaleHubs.length > 0;
}

function section(title, items) {
  if (!items.length) return [`### ${title}: none`, ''];
  return [`### ${title}: ${items.length}`, ...items.map((i) => `- ${i}`), ''];
}

// Actionable variant (Fowler "prompt injection" principle, same discipline
// gap G18 applies to its own block messages): name the hub AND tell the agent
// what to run, not just state a count.
function modularityStalenessSection(items) {
  const title = 'New modularity-review staleness';
  if (!items.length) return [`### ${title}: none`, ''];
  const lines = items.map((i) =>
    `- ${i} — unstable since the last real review; run \`/brownfield --full\` ` +
    'or `/design --delta` (Step D3.5) to re-review before it drifts further.'
  );
  return [`### ${title}: ${items.length}`, ...lines, ''];
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
    .concat(modularityStalenessSection(diff.newModularityStaleHubs))
    .concat([`_Totals: ${curr.files} files, ${curr.edges} edges, ${curr.cycles.length} cycles, ` +
      `${curr.orphans.length} orphans, ${curr.depCves.length} dep-alerts, ` +
      `${(curr.canvasDrift || []).length} canvas-drift, ` +
      `${(curr.modularityStaleHubs || []).length} modularity-stale ` +
      `(Δfiles ${diff.fileDelta}, Δedges ${diff.edgeDelta})._`, ''])
    .join('\n');
}

module.exports = {
  extractMetrics, withDepCves, withCanvasDrift, withModularityStaleness, carryForwardArch,
  diffSnapshots, hasRegressed, renderDriftReport, cycleKey, unstableHubIds, hubsForStabilityCheck,
};
