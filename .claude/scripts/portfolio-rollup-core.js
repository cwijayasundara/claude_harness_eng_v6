'use strict';

// Pure aggregator for the portfolio compliance rollup (Increment 4b). No IO here
// — portfolio-rollup.js reads the per-repo attestation files and passes the
// parsed bundles in; this module verifies each one's integrity, computes
// version-drift, and shapes the integrity-hashed portfolio report. Kept pure so
// the fail-safe aggregation + semver logic is testable against REAL 4a bundles
// without touching the filesystem or gh.
//
// Reuses canonical-json.contentHash for BOTH verifying each input attestation's
// integrity (recompute over content-minus-integrity, compare stored hash) and
// stamping the rollup report's own sha256 integrity hash — same corruption-
// detecting-checksum property as the 4a attestation (authenticity via signing
// is the documented seam, not built here).

const { contentHash } = require('./canonical-json');

const SCHEMA_VERSION = 1;

// Numeric major.minor.patch ONLY (anchored) => anything else (missing, non-string,
// garbage, or a pre-release/build suffix like 2.5.0-rc1) yields null, so the caller
// reports 'unknown' rather than silently treating it as current/behind/ahead.
function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Compare a (a repo's harness_version) against b (the target): 'current' equal,
// 'behind' older, 'ahead' newer; either side unparseable => 'unknown' (never a
// silent 'current').
function semverCompare(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return 'unknown';
  for (let i = 0; i < 3; i += 1) {
    if (x[i] < y[i]) return 'behind';
    if (x[i] > y[i]) return 'ahead';
  }
  return 'current';
}

// An attestation's integrity is OK only when it carries a sha256 integrity block
// whose stored hash matches a recompute over its canonical content-minus-integrity.
// A missing/wrong-algo/mismatched (tampered) or unreadable bundle => false.
function verifyIntegrity(att) {
  if (!att || typeof att !== 'object') return false;
  const integ = att.integrity;
  if (!integ || integ.algo !== 'sha256' || typeof integ.hash !== 'string') return false;
  return integ.hash === contentHash(att);
}

// One per-repo row. A tampered/failed-integrity or unreadable attestation is
// recorded (integrity_ok:false) — never dropped and never counted compliant.
// `compliant` is the effective flag: integrity_ok AND the bundle's status is
// 'compliant'. version_drift compares the bundle's harness_version to the target.
function buildRow(att, repoFallback, target) {
  if (!att || typeof att !== 'object') {
    return { repo: repoFallback, commit_sha: null, status: 'unreadable', compliant: false,
      harness_version: null, integrity_ok: false, version_drift: 'unknown' };
  }
  const integrity_ok = verifyIntegrity(att);
  const status = typeof att.status === 'string' ? att.status : 'unknown';
  const harness_version = (typeof att.harness_version === 'string' && att.harness_version.trim())
    ? att.harness_version : null;
  return {
    repo: att.repo || repoFallback,
    commit_sha: att.commit_sha || null,
    status,
    compliant: integrity_ok && status === 'compliant',
    harness_version,
    integrity_ok,
    version_drift: semverCompare(harness_version, target),
  };
}

// A fleet repo with no attestation file on disk: a recorded compliance gap, never
// a silent omission (no vacuous portfolio green).
function notAttestedRow(repo) {
  return { repo, commit_sha: null, status: 'not-attested', compliant: false,
    harness_version: null, integrity_ok: false, version_drift: 'unknown' };
}

// Mutually-exclusive summary bucket for one row. Order matters: not-attested and
// failed-integrity are classified before status so a tampered 'compliant' bundle
// lands in integrity_failed, never compliant.
function bucket(row) {
  if (row.status === 'not-attested') return 'not_attested';
  if (!row.integrity_ok) return 'integrity_failed';
  if (row.status === 'compliant') return 'compliant';
  if (row.status === 'not-evaluated') return 'not_evaluated';
  return 'non_compliant';
}

function summarize(rows) {
  // The 5 status buckets are the authoritative, mutually-exclusive total. The 4
  // version buckets are exhaustive over version_drift so an auditor can reconcile
  // them (current + behind + ahead + unknown === total).
  const s = { total: rows.length, compliant: 0, non_compliant: 0, not_evaluated: 0,
    not_attested: 0, integrity_failed: 0,
    version_current: 0, version_behind: 0, version_ahead: 0, version_unknown: 0 };
  for (const r of rows) {
    s[bucket(r)] += 1;
    if (r.version_drift === 'current') s.version_current += 1;
    else if (r.version_drift === 'behind') s.version_behind += 1;
    else if (r.version_drift === 'ahead') s.version_ahead += 1;
    else s.version_unknown += 1;
  }
  return s;
}

// Assemble the full rollup and stamp its sha256 integrity hash last.
// portfolio_compliant is fail-safe: true only when the portfolio is non-empty AND
// every repo is in the compliant bucket (compliant + integrity_ok + attested);
// any non-compliant/not-evaluated/not-attested/integrity_failed repo, or an empty
// portfolio, keeps it false.
function buildReport({ rows, target, now }) {
  const summary = summarize(rows);
  const report = {
    schema_version: SCHEMA_VERSION,
    generated_at: now,
    target_harness_version: target || null,
    repos: rows,
    summary,
    version_drift: rows.map((r) => ({ repo: r.repo, harness_version: r.harness_version, target: target || null })),
    portfolio_compliant: summary.total > 0 && summary.compliant === summary.total,
  };
  report.integrity = { algo: 'sha256', hash: contentHash(report) };
  return report;
}

module.exports = {
  semverCompare,
  verifyIntegrity,
  buildRow,
  notAttestedRow,
  bucket,
  summarize,
  buildReport,
  SCHEMA_VERSION,
};
