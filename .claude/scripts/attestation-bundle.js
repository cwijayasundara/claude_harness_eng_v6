'use strict';

// Pure builder for the compliance-attestation evidence bundle (Increment 4a).
// No IO here — generate-attestation.js reads the files and passes the parsed
// inputs in; this module shapes them into the immutable, hashable bundle. Kept
// pure so the assembly + compliance logic is testable against the REAL manifest
// without touching the filesystem or git.

const { contentHash } = require('./canonical-json');

const EVIDENCE_FORMAT_VERSION = 'harness-attestation/1';
const SCHEMA_VERSION = 1;

// Resolve a control's clause id: a specific per-id mapping wins over the per-axis
// fallback; an axis the map doesn't cover is recorded as "unmapped" (auditable,
// never a silent gap). No client literals — the map is data (C3).
function resolveStandardRef(control, map) {
  const byId = (map && map.by_id) || {};
  const byAxis = (map && map.by_axis) || {};
  if (control && byId[control.id]) return byId[control.id];
  if (control && byAxis[control.axis]) return byAxis[control.axis];
  return 'unmapped';
}

function countBy(entries, keyFn) {
  const out = {};
  for (const e of entries) {
    const k = keyFn(e);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function allEntries(manifest) {
  const guides = Array.isArray(manifest && manifest.guides) ? manifest.guides : [];
  const sensors = Array.isArray(manifest && manifest.sensors) ? manifest.sensors : [];
  return { guides, sensors, all: [...guides, ...sensors] };
}

function buildInventory(manifest) {
  const { guides, sensors, all } = allEntries(manifest);
  return {
    total: all.length,
    guides: guides.length,
    sensors: sensors.length,
    by_axis: countBy(all, (e) => e.axis),
    by_status: countBy(all, (e) => e.status || 'active'),
  };
}

// One row per registered control. Guides carry no cadence -> null (recorded,
// not omitted). status defaults to "active" the same way the validator does.
function buildControls(manifest, map) {
  return allEntries(manifest).all.map((e) => ({
    id: e.id,
    axis: e.axis,
    cadence: e.cadence || null,
    status: e.status || 'active',
    standard_ref: resolveStandardRef(e, map),
  }));
}

// Fail-safe source evaluation. generate-attestation.js classifies each of the
// three sources (branch_protection, deploy_gate, gate) into one state:
//   'pass'    present, valid, and passing
//   'fail'    present, valid, and failing
//   'invalid' present but unparseable OR missing a boolean verdict (corrupt)
//   'absent'  file not present
// A present-but-bad source (fail OR invalid) forces non-compliant — a corrupt or
// truncated verify file is NEVER a silent green. Only when EVERY source is absent
// do we report "not-evaluated" (compliant:false, no vacuous green). "compliant" is
// strictly status === 'compliant': at least one source evaluated and none bad.
function computeStatus(sourceStates) {
  const states = [
    sourceStates.branch_protection,
    sourceStates.deploy_gate,
    sourceStates.gate,
  ];
  const evaluated = states.filter((s) => s === 'pass' || s === 'fail').length;
  const anyBad = states.some((s) => s === 'fail' || s === 'invalid');
  let status;
  if (anyBad) status = 'non-compliant';
  else if (evaluated === 0) status = 'not-evaluated';
  else status = 'compliant';
  return {
    status,
    compliant: status === 'compliant',
    sources_evaluated: evaluated,
    sources_total: states.length,
  };
}

// Assemble the full bundle and stamp its sha256 integrity hash last.
function buildBundle(parts) {
  const { identity, manifest, standardMap, standardMapSource, verify, gate, sourceStates, ratchets } = parts;
  const ev = computeStatus(sourceStates);
  const bundle = {
    schema_version: SCHEMA_VERSION,
    evidence_format_version: EVIDENCE_FORMAT_VERSION,
    repo: identity.repo,
    commit_sha: identity.commit_sha,
    generated_at: identity.generated_at,
    harness_version: identity.harness_version,
    standard_ref: (standardMap && standardMap.id) || 'unmapped',
    standard_map_source: standardMapSource || 'built-in-default',
    control_inventory: buildInventory(manifest),
    controls: buildControls(manifest, standardMap),
    verify,
    gate,
    sources: sourceStates,
    sources_evaluated: ev.sources_evaluated,
    sources_total: ev.sources_total,
    ratchets,
    status: ev.status,
    compliant: ev.compliant,
  };
  bundle.integrity = { algo: 'sha256', hash: contentHash(bundle) };
  return bundle;
}


// ---- in-toto Statement envelope (C2) ----
//
// The bundle is wrapped in an in-toto Statement rather than shipped as a bespoke JSON
// shape. in-toto defines the envelope and is what cosign/Sigstore sign, so adopting it
// makes the evidence recognisable to standard tooling instead of only to this harness.
//
// The predicateType is OURS on purpose. SLSA provenance describes how an ARTIFACT was
// built by a trusted builder; this is control evidence about a COMMIT. Borrowing
// slsa.dev/provenance for it would be a category error that reads as a stronger claim
// than we make. in-toto exists to carry custom predicates — this is that case.
const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
const PREDICATE_TYPE = 'https://claude-harness.dev/attestation/control-evidence/v1';

function subjectFor(bundle) {
  const repo = bundle && bundle.repo;
  return [{
    name: repo ? `git+https://github.com/${repo}` : 'git+unknown',
    digest: { gitCommit: (bundle && bundle.commit_sha) || 'unknown' },
  }];
}

function toInTotoStatement(bundle) {
  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: subjectFor(bundle),
    predicateType: PREDICATE_TYPE,
    predicate: bundle,
  };
}

function isInTotoStatement(doc) {
  return !!(doc && doc._type === IN_TOTO_STATEMENT_TYPE);
}

// Accepts either shape. A pre-C2 bundle passes through unchanged so evidence written
// before this change stays readable — an auditor holding last quarter's attestation
// should not need this quarter's tooling. Anything malformed throws rather than
// returning an empty object, which would read downstream as "no findings".
function fromInTotoStatement(doc) {
  if (!isInTotoStatement(doc)) return doc;
  if (doc.predicateType !== PREDICATE_TYPE) {
    throw new Error(
      `attestation: unexpected predicateType ${doc.predicateType} — expected ${PREDICATE_TYPE}. ` +
      'Reading another predicate as our control evidence would be a silent category error.'
    );
  }
  if (!doc.predicate || typeof doc.predicate !== 'object') {
    throw new Error('attestation: in-toto statement has no predicate — it carries no evidence');
  }
  return doc.predicate;
}

module.exports = {
  toInTotoStatement,
  fromInTotoStatement,
  isInTotoStatement,
  IN_TOTO_STATEMENT_TYPE,
  PREDICATE_TYPE,
  buildBundle,
  buildInventory,
  buildControls,
  resolveStandardRef,
  computeStatus,
  EVIDENCE_FORMAT_VERSION,
  SCHEMA_VERSION,
};
