'use strict';

// Cluster last-N gate/eval/failure-log rows by cause class for /retro.
// Report-only: "most agent failures are configuration failures."

const CAUSE_BY_SENSOR = Object.freeze({
  'live-externals': 'skipped-verification',
  'test-integrity': 'skipped-verification',
  'at-first-gate': 'skipped-verification',
  'at-first-proof': 'skipped-verification',
  'tdd-test-first': 'skipped-verification',
  'test-deletion-guard': 'skipped-verification',
  'trajectory-contract': 'skipped-verification',
  'stub-smell-gate': 'skipped-verification',
  'secret-scan': 'security',
  'security-baseline': 'security',
  'secure-baseline-wiring': 'security',
  sast: 'security',
  'layer-imports': 'architecture',
  'cycle-detection': 'architecture',
  'coupling-ratchet': 'architecture',
  'ownership-check': 'architecture',
  'type-check': 'quality',
  'coverage-ratchet-py': 'quality',
  'coverage-ratchet-js': 'quality',
  'mutation-smoke': 'quality',
  'generation-contract': 'spec-gap',
  'story-bundle-check': 'spec-gap',
  'canvas-sync-check': 'spec-gap',
  'prd-shape-gate': 'spec-gap',
  'spec-decisions-gate': 'spec-gap',
  'token-governor': 'context-miss',
  'token-advisor': 'context-miss',
  'context-pack': 'context-miss',
  'registry-names': 'hallucinated-dep',
});

const CAUSE_BY_FAILURE_CAT = Object.freeze({
  type_error: 'quality',
  lint_format: 'quality',
  test_failure: 'skipped-verification',
  contract_fail: 'spec-gap',
  security: 'security',
});

function causeOf(row) {
  if (row.sensor && CAUSE_BY_SENSOR[row.sensor]) return CAUSE_BY_SENSOR[row.sensor];
  if (row.category && CAUSE_BY_FAILURE_CAT[row.category]) return CAUSE_BY_FAILURE_CAT[row.category];
  return 'unknown';
}

function clusterFailures(rows, { limit = 50 } = {}) {
  const window = (rows || []).slice(-limit);
  const clusters = {};
  for (const row of window) {
    const cause = causeOf(row);
    const bucket = clusters[cause] || { count: 0, evidence: [] };
    bucket.count += 1;
    if (bucket.evidence.length < 5) {
      bucket.evidence.push(row.sensor || row.category || 'row');
    }
    clusters[cause] = bucket;
  }
  const ranked = Object.entries(clusters).sort((a, b) => b[1].count - a[1].count);
  const dominant = ranked.length && ranked[0][1].count >= 2 ? ranked[0][0] : null;
  return { clusters, dominant, window: window.length };
}

function clusterNotes(clustered) {
  if (!clustered || !clustered.dominant) return [];
  const n = clustered.clusters[clustered.dominant].count;
  return [
    `Failure cause "${clustered.dominant}" clustered ${n}× over ${clustered.window} events — `
    + 'inspect tools, rules, and context before swapping models.',
  ];
}

function rowsFromLedgers(blockedOutcomes, failureCategories) {
  const rows = (blockedOutcomes || []).map((o) => ({ sensor: o.sensor }));
  for (const [category, n] of Object.entries(failureCategories || {})) {
    for (let i = 0; i < n; i += 1) rows.push({ category });
  }
  return rows;
}

function clusterTableLines(clustered) {
  if (!clustered || !clustered.window) return ['- No clustered failures in the window.'];
  const rows = ['| Cause | Count |', '|---|---|'];
  const ranked = Object.entries(clustered.clusters).sort((a, b) => b[1].count - a[1].count);
  for (const [cause, bucket] of ranked) rows.push(`| ${cause} | ${bucket.count} |`);
  return rows;
}

module.exports = {
  CAUSE_BY_SENSOR, causeOf, clusterFailures, clusterNotes, clusterTableLines,
  rowsFromLedgers,
};
