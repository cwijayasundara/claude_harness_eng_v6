'use strict';

// Environment diff/compare helpers for provision-environments.js — the pure-diff
// sibling of ruleset-diff.js (Increment 3). Split out so the provisioner stays
// within the harness length gate. Pure functions only; no gh/network here.
// Copied to scaffolded targets alongside provision-environments.js.
//
// Operates on the canonical GitHub Environments shape (the PUT body):
//   { name, wait_timer, reviewers:[{type,id}], deployment_branch_policy:{ protected_branches, custom_branch_policies } }
// The live "Get an environment" GET response is NOT in this shape — it nests
// reviewers/wait_timer under protection_rules[]. Callers MUST run it through
// normalizeLiveEnvironment() before planDiff/computeDrift.

function drift(field, expected, actual) {
  return { field, expected, actual: actual === undefined ? null : actual };
}

// Fold the GitHub "Get an environment" GET response into the canonical flat shape
// the diff operates on. The GET nests reviewers/wait_timer under protection_rules[]
// ({type:'required_reviewers', reviewers:[{type, reviewer:{id}}]} and
// {type:'wait_timer', wait_timer}); only deployment_branch_policy is top-level. An
// already-flat body (no protection_rules) passes through unchanged. Without this,
// live.reviewers is undefined → the approval-gate floor fires on a correctly-gated
// environment and verify can never report green (mirrors ruleset-diff's rules[]
// indexing).
function normalizeLiveEnvironment(env) {
  if (!env || typeof env !== 'object' || !Array.isArray(env.protection_rules)) return env;
  let waitTimer = 0;
  let reviewers = [];
  for (const rule of env.protection_rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (rule.type === 'wait_timer') waitTimer = Number(rule.wait_timer) || 0;
    else if (rule.type === 'required_reviewers') {
      reviewers = (Array.isArray(rule.reviewers) ? rule.reviewers : [])
        .map((r) => ({ type: r && r.type, id: r && r.reviewer && r.reviewer.id }));
    }
  }
  return {
    name: env.name,
    wait_timer: waitTimer,
    reviewers,
    deployment_branch_policy: env.deployment_branch_policy || {},
  };
}

// Order-independent reviewer identity: type:id pairs, sorted.
function reviewerKeys(reviewers) {
  return (Array.isArray(reviewers) ? reviewers : []).map((r) => `${r && r.type}:${r && r.id}`).sort();
}

function branchPolicy(env) {
  return (env && env.deployment_branch_policy) || {};
}

// Config-driven field-by-field comparison of a desired environment vs the live
// one. Pure structural diff — the approval-gate FLOOR is applied separately in
// computeDrift (verify side), never here, so plan can preview honestly.
function compareEnvironment(desired, live) {
  const out = [];
  const l = live || {};
  if (Number(l.wait_timer || 0) !== Number(desired.wait_timer || 0)) {
    out.push(drift('wait_timer', desired.wait_timer, l.wait_timer));
  }
  const want = reviewerKeys(desired.reviewers);
  const have = reviewerKeys(l.reviewers);
  if (JSON.stringify(want) !== JSON.stringify(have)) out.push(drift('reviewers', want, have));
  const dPol = branchPolicy(desired);
  const lPol = branchPolicy(l);
  if (!!lPol.protected_branches !== !!dPol.protected_branches) {
    out.push(drift('deployment_branch_policy.protected_branches', dPol.protected_branches, lPol.protected_branches));
  }
  if (!!lPol.custom_branch_policies !== !!dPol.custom_branch_policies) {
    out.push(drift('deployment_branch_policy.custom_branch_policies', dPol.custom_branch_policies, lPol.custom_branch_policies));
  }
  return out;
}

function planDiff(desired, live) {
  if (!live) return { action: 'create', changes: [] };
  const changes = compareEnvironment(desired, live);
  return changes.length ? { action: 'update', changes } : { action: 'compliant', changes: [] };
}

// APPROVAL-GATE FLOOR: a deploy-approval gate is only real with >=1 required
// reviewer AND a branch restriction. A live environment whose reviewers is empty
// OR whose protected_branches is false is non-compliant regardless of config —
// even a project that (mis)configured reviewers:[] must fail verify, so a
// zero-approver "gate" can never read as green.
function floorViolations(live) {
  const out = [];
  const l = live || {};
  if (reviewerKeys(l.reviewers).length === 0) {
    out.push(drift('approval-gate-floor.reviewers', '>=1 required reviewer', reviewerKeys(l.reviewers).length));
  }
  if (!branchPolicy(l).protected_branches) {
    out.push(drift('approval-gate-floor.protected_branches', true, branchPolicy(l).protected_branches || false));
  }
  return out;
}

// Verify-side drift: config diff PLUS the approval-gate floor. An absent live
// environment is itself drift (and the floor also fires on the empty live).
function computeDrift(desired, live) {
  if (!live) {
    return { compliant: false, drift: [drift('presence', 'present', 'absent'), ...floorViolations(null)] };
  }
  const seen = new Set();
  const all = [];
  for (const d of [...compareEnvironment(desired, live), ...floorViolations(live)]) {
    const key = JSON.stringify([d.field, d.expected, d.actual]);
    if (!seen.has(key)) { seen.add(key); all.push(d); }
  }
  return { compliant: all.length === 0, drift: all };
}

module.exports = { drift, reviewerKeys, compareEnvironment, planDiff, floorViolations, computeDrift, normalizeLiveEnvironment };
