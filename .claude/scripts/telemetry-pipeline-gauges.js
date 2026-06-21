'use strict';

// Derives pipeline-progress gauges (features passing/total, coverage vs
// baseline) from the normalized pipeline snapshot so the Grafana dashboard, the
// /status CLI, and the push path all share one source of truth. Returns
// Prometheus text lines that pushSnapshot appends to its body — emitted ONLY
// when real data exists, so a fresh project still pushes an empty body.
// See docs/internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md §3 Part B.

const { buildSnapshot } = require('./pipeline-snapshot');

function pipelineGaugeLines(projectDir) {
  let snap;
  try {
    snap = buildSnapshot(projectDir);
  } catch (_) {
    return '';
  }
  const lines = [];
  if (snap.features.total > 0) {
    lines.push(`harness_features_passing ${snap.features.passing}`);
    lines.push(`harness_features_total ${snap.features.total}`);
  }
  if (snap.coverage.current != null) lines.push(`harness_coverage ${snap.coverage.current}`);
  if (snap.coverage.baseline != null) lines.push(`harness_coverage_baseline ${snap.coverage.baseline}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

module.exports = { pipelineGaugeLines };
