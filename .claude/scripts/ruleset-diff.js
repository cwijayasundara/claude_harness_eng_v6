'use strict';

// Ruleset diff/compare helpers for provision-protection.js — order-independent,
// keyed by rule type. Split out of provision-protection.js so that file stays
// within the harness length gate after the Increment-2 review hardening
// (scope-aware repository targeting + the security floor). Pure functions only;
// no gh/network here. Copied to scaffolded targets alongside provision-protection.js.

function rulesByType(ruleset) {
  const out = {};
  for (const r of (ruleset && ruleset.rules) || []) out[r.type] = r;
  return out;
}

function drift(rule, field, expected, actual) {
  return { rule, field, expected, actual };
}

function comparePullRequest(desired, live, out) {
  const d = desired.parameters;
  const l = (live && live.parameters) || {};
  for (const k of ['required_approving_review_count', 'require_code_owner_review', 'dismiss_stale_reviews_on_push']) {
    if (JSON.stringify(l[k]) !== JSON.stringify(d[k])) out.push(drift('pull_request', k, d[k], l[k] === undefined ? null : l[k]));
  }
}

function compareStatusChecks(desired, live, out) {
  const d = desired.parameters;
  const l = (live && live.parameters) || {};
  if (l.strict_required_status_checks_policy !== d.strict_required_status_checks_policy) {
    out.push(drift('required_status_checks', 'strict_required_status_checks_policy',
      d.strict_required_status_checks_policy, l.strict_required_status_checks_policy === undefined ? null : l.strict_required_status_checks_policy));
  }
  const want = d.required_status_checks.map((c) => c.context).sort();
  const have = (l.required_status_checks || []).map((c) => c.context).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) {
    out.push(drift('required_status_checks', 'required_status_checks', want, have));
  }
}

// Compare a ref-name/repository-name include list order-independently.
function compareInclude(field, want, have, out) {
  if (JSON.stringify([...want].sort()) !== JSON.stringify([...have].sort())) {
    out.push(drift('conditions', field, want, have));
  }
}

function compareRulesets(desired, live) {
  const out = [];
  if (String((live && live.enforcement)) !== desired.enforcement) {
    out.push(drift('enforcement', 'enforcement', desired.enforcement, (live && live.enforcement) || null));
  }
  const liveCond = (live && live.conditions) || {};
  compareInclude('ref_name.include', desired.conditions.ref_name.include,
    (liveCond.ref_name || {}).include || [], out);
  // Org-scope rulesets carry a repository_name target; repo-scope ones must not.
  // Only compare it when the desired spec has it (i.e. org scope) — an omitted
  // target on a repo-scope ruleset is correct, not drift.
  if (desired.conditions.repository_name) {
    compareInclude('repository_name.include', desired.conditions.repository_name.include,
      (liveCond.repository_name || {}).include || [], out);
  }
  const dTypes = rulesByType(desired);
  const lTypes = rulesByType(live);
  comparePullRequest(dTypes.pull_request, lTypes.pull_request, out);
  compareStatusChecks(dTypes.required_status_checks, lTypes.required_status_checks, out);
  for (const t of ['non_fast_forward', 'deletion']) {
    if (!lTypes[t]) out.push(drift(t, t, 'present', 'absent'));
  }
  if (((live && live.bypass_actors) || []).length !== 0) {
    out.push(drift('bypass_actors', 'bypass_actors', [], live.bypass_actors));
  }
  return out;
}

function planDiff(desired, live) {
  if (!live) return { action: 'create', changes: [] };
  const changes = compareRulesets(desired, live);
  return changes.length ? { action: 'update', changes } : { action: 'compliant', changes: [] };
}

function computeDrift(desired, live) {
  const d = compareRulesets(desired, live);
  return { compliant: d.length === 0, drift: d };
}

module.exports = { rulesByType, drift, compareRulesets, planDiff, computeDrift };
