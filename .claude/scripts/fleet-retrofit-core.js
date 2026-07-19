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

// A gate the operator never configured. The provisioners collapse "nothing to
// provision" onto exit 0 (provision-environments returns 0 when github.environments
// is empty; provision-protection returns 0 when there is no github section), which
// classifyGate cannot distinguish from "verified compliant". So the RUNNER decides
// configured-ness from the manifest up front (fleet-retrofit.js) and hands this
// state in directly — a not-configured gate is NEVER 'gated' and never counts
// toward fleet_gated, so an unconfigured gate can never read as a false green.
// Kept out of classifyGate on purpose: exit 0 alone is not enough to tell them apart.

// A repo is 'gated' only when BOTH gates are gated; otherwise it takes its worst
// gate. Precedence over the non-gated states (a gate is only ever one of these):
// failed > not-configured > not-gating > drifted.
const NON_GATED_PRECEDENCE = ['failed', 'not-configured', 'not-gating', 'drifted'];
function rollupRepo(bp, dg) {
  if (bp === 'gated' && dg === 'gated') return 'gated';
  for (const s of NON_GATED_PRECEDENCE) if (bp === s || dg === s) return s;
  return 'drifted';
}

function summarize(rows) {
  const s = { total: rows.length, gated: 0, drifted: 0, not_gating: 0, not_configured: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === 'gated') s.gated += 1;
    else if (r.status === 'drifted') s.drifted += 1;
    else if (r.status === 'not-gating') s.not_gating += 1;
    else if (r.status === 'not-configured') s.not_configured += 1;
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
