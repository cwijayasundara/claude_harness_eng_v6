'use strict';

// Pure classification/aggregation for the fleet-retrofit runner. No IO here —
// fleet-retrofit.js invokes the Inc 2/3 provisioners per repo, captures their
// apply/verify exit codes, and passes them in; this module turns those codes into
// per-gate states, rolls each repo up, and shapes the aggregate report. Kept pure
// so the classification + fail-safe fleet_gated logic is unit-testable without gh.
//
// Provisioner exit-code contract this depends on:
//   provision-protection  --apply : 0 applied / 2 failed
//   provision-protection  --verify: 0 compliant / 1 drift / 2 read-or-gh error
//   provision-environments --apply : 0 applied+gating / 3 applied-but-empty-reviewers / 2 failed
//   provision-environments --verify: 0 compliant / 1 drift / 2 error

const SCHEMA_VERSION = 1;

// One gate's state from its provisioner codes. In apply mode an apply failure (2)
// is 'failed' and an env empty-reviewers apply (3) is 'not-gating' — decided from
// the apply code BEFORE the verify code, since they are more specific. Otherwise
// the verify code decides: 0 gated, 1 drifted, anything else (2 or unexpected)
// fail-safe to 'failed' so a read error is never mistaken for gated.
function classifyGate(kind, mode, applyCode, verifyCode) {
  if (mode === 'apply' && applyCode === 2) return 'failed';
  if (mode === 'apply' && kind === 'env' && applyCode === 3) return 'not-gating';
  if (verifyCode === 0) return 'gated';
  if (verifyCode === 1) return 'drifted';
  return 'failed';
}

// A repo is 'gated' only when BOTH gates are gated; otherwise it takes its worst
// gate: failed > not-gating > drifted (a gate can't be anything else here).
function rollupRepo(bp, dg) {
  if (bp === 'gated' && dg === 'gated') return 'gated';
  if (bp === 'failed' || dg === 'failed') return 'failed';
  if (bp === 'not-gating' || dg === 'not-gating') return 'not-gating';
  return 'drifted';
}

function summarize(rows) {
  const s = { total: rows.length, gated: 0, drifted: 0, not_gating: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === 'gated') s.gated += 1;
    else if (r.status === 'drifted') s.drifted += 1;
    else if (r.status === 'not-gating') s.not_gating += 1;
    else s.failed += 1;
  }
  return s;
}

// The aggregate report. fleet_gated is fail-safe: true only when the fleet is
// non-empty AND every repo is gated; an empty fleet or any non-gated repo => false.
function buildReport({ rows, mode, now }) {
  const summary = summarize(rows);
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: now,
    mode,
    repos: rows,
    summary,
    fleet_gated: summary.total > 0 && summary.gated === summary.total,
  };
}

module.exports = { classifyGate, rollupRepo, summarize, buildReport, SCHEMA_VERSION };
