#!/usr/bin/env node

'use strict';

// Deployment-approval Environments provisioner (Increment 3). Provisions the
// GitHub Environment approval gate the CISO mandate needs: an Environment with
// required reviewers that must approve before a deploy job runs. Sibling of
// provision-protection.js (branch-protection), same idioms:
//
//   plan (default) : GET each configured environment, diff vs desired, print
//                    create/update/compliant + the org-admin note. Exit 0, never
//                    errors (no config / no gh).
//   --apply        : idempotent PUT repos/{owner}/{repo}/environments/{name} per
//                    environment. Environments are PER-REPO (no org-level API),
//                    so apply REQUIRES --repo <owner/repo> or --fleet f.json.
//   --verify       : GET each environment, diff vs desired (+ approval-gate
//                    FLOOR), write specs/reviews/deploy-gate-verify.json, exit
//                    non-zero on drift.
//
// Every identifier (repo, environment name, reviewer ids) comes from
// project-manifest.json#github.environments — no client literals here. Reviewers
// default to [] (loud ACTION-REQUIRED notice on apply; verify reports empty as
// non-compliant). gh runs through an injected runner (execFileSync('gh', argv)
// with literal argv) and every call is result-object so it never throws.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { planDiff, computeDrift, normalizeLiveEnvironment } = require('./env-diff');

function defaultGh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input });
}

// --- desired body builder (config-driven; documented Environments API shape) ---

// Reviewer entries are client-specific and must never be silently dropped: a
// malformed entry (bad type or non-positive-integer id) is a hard config error
// in apply/verify. type in {User,Team}, id a positive integer.
function reviewerError(reviewers) {
  if (reviewers === undefined) return null;
  if (!Array.isArray(reviewers)) return 'reviewers must be an array of { type, id }';
  for (const r of reviewers) {
    if (!r || (r.type !== 'User' && r.type !== 'Team')) return `reviewer type must be "User" or "Team" (got ${JSON.stringify(r && r.type)})`;
    if (!Number.isInteger(r.id) || r.id <= 0) return `reviewer id must be a positive integer (got ${JSON.stringify(r && r.id)})`;
  }
  return null;
}

function buildDesiredEnvironment(env) {
  // Defensive: a non-array reviewers is caught as a hard error in apply/verify
  // (reviewerConfigError); here it degrades to [] so read-only plan never throws.
  const reviewers = Array.isArray(env.reviewers) ? env.reviewers : [];
  return {
    name: env.name,
    wait_timer: Number(env.wait_timer) || 0,
    reviewers: reviewers.map((r) => ({ type: r.type, id: r.id })),
    deployment_branch_policy: {
      protected_branches: env.protected_branches !== false,
      custom_branch_policies: false,
    },
  };
}

// --- gh access (result-object, never throws) ---------------------------------

function ghGet(runner, apiPath) {
  try {
    // The live GET nests reviewers/wait_timer under protection_rules[]; fold it
    // into the canonical flat shape the diff operates on (env-diff).
    return { ok: true, data: normalizeLiveEnvironment(JSON.parse(runner(['api', apiPath]))) };
  } catch (err) {
    const reason = String((err && err.message) || err).split('\n')[0];
    // Only the actual gh "HTTP 404" status line means "environment not yet
    // created" (absent). A bare "404"/"Not Found" substring can appear in
    // unrelated errors (and a missing repo also 404s) — don't over-match and
    // mask a real read failure as "absent".
    if (/HTTP 404\b/.test(reason)) return { ok: true, data: null };
    return { ok: false, reason };
  }
}

// Reject config values that would manipulate the gh API path (traversal / extra
// segments). owner/repo/name are single path segments of [A-Za-z0-9._-], no "..".
const SEGMENT = /^[A-Za-z0-9._-]+$/;
function validSegment(s) { return typeof s === 'string' && SEGMENT.test(s) && !s.includes('..'); }

function invalidRepoReason(repo) {
  const parts = String(repo).split('/');
  if (parts.length !== 2 || !parts.every(validSegment)) {
    return `invalid repo "${repo}" (expected owner/repo, chars [A-Za-z0-9._-], no "..")`;
  }
  return null;
}

// The environment name is concatenated into the gh API path, so it must be a
// single safe path segment (no "/", no "..") on every mode — otherwise a config
// name like "prod/../../orgs/x" targets an unintended resource on a fleet-wide
// state-changing PUT.
function nameConfigError(environments) {
  for (const env of environments) {
    if (!validSegment(env && env.name)) {
      return `environment name ${JSON.stringify(env && env.name)} is invalid (chars [A-Za-z0-9._-], no "/", no "..")`;
    }
  }
  return null;
}

function envPath(repo, name) {
  return `repos/${repo}/environments/${name}`;
}

// --- manifest + scope resolution ---------------------------------------------

function readGithub(cwd) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cwd, 'project-manifest.json'), 'utf8'));
    return (m && m.github) || null;
  } catch (_) { return null; }
}

// Environments are repo-scoped: apply/verify need --repo or --fleet. Neither ->
// null scopes so the caller can exit 2 with the repo-scoped message.
function resolveRepoScopes(flags) {
  if (flags.repo) return { ok: true, scopes: [flags.repo] };
  if (flags.fleet) {
    try {
      const reg = JSON.parse(fs.readFileSync(flags.fleet, 'utf8'));
      return { ok: true, scopes: (reg.repos || []).map((r) => `${r.owner}/${r.repo}`) };
    } catch (err) {
      return { ok: false, reason: `cannot read fleet registry ${flags.fleet}: ${String((err && err.message) || err).split('\n')[0]}` };
    }
  }
  return { ok: false, repoScoped: true };
}

function parseFlags(argv) {
  const flags = { mode: 'plan' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') flags.mode = 'apply';
    else if (a === '--verify') flags.mode = 'verify';
    else if (a === 'plan') flags.mode = 'plan';
    else if (a === '--repo') flags.repo = argv[++i];
    else if (a === '--fleet') flags.fleet = argv[++i];
  }
  return flags;
}

// --- mode handlers ------------------------------------------------------------

const ADMIN_NOTE = 'Note: --apply requires org-admin (or repo-admin) rights on GitHub; plan/verify are read-only.\n';
const REPO_SCOPED = 'provision-environments: GitHub Environments are repo-scoped (no org-level environments API) — pass --repo <owner/repo> or --fleet fleet.json.\n';

function planOne(runner, repo, desired) {
  const got = repo ? ghGet(runner, envPath(repo, desired.name)) : { ok: true, data: null };
  if (!got.ok) { process.stdout.write(`plan: could not read environment "${desired.name}" (${got.reason}). Preview only.\n`); return; }
  const res = planDiff(desired, got.data);
  if (res.action === 'create') process.stdout.write(`plan: would CREATE environment "${desired.name}"${repo ? ` on ${repo}` : ''}.\n`);
  else if (res.action === 'compliant') process.stdout.write(`plan: environment "${desired.name}" is already compliant.\n`);
  else process.stdout.write(`plan: would UPDATE environment "${desired.name}":\n${res.changes.map((c) => `  - ${c.field}: ${JSON.stringify(c.actual)} -> ${JSON.stringify(c.expected)}`).join('\n')}\n`);
}

function runPlan(desiredList, runner, flags) {
  const resolved = resolveRepoScopes(flags);
  const repos = resolved.ok ? resolved.scopes : [null]; // no repo -> desired-only preview
  for (const repo of repos) for (const desired of desiredList) planOne(runner, repo, desired);
  process.stdout.write(ADMIN_NOTE);
  return 0;
}

// Loud ACTION-REQUIRED notice for a provisioned environment with no reviewers —
// the same literal-free empty-set warning materializeCodeowners uses.
function warnEmptyReviewers(name, repo) {
  process.stderr.write(
    `ACTION REQUIRED: environment "${name}" on ${repo} was provisioned with NO required reviewers — ` +
    'the deploy-approval gate will NOT require approval until reviewer ids are set in ' +
    'project-manifest.json#github.environments[].reviewers ([{ "type":"User"|"Team", "id":<numeric> }]).\n');
}

function applyOne(runner, repo, desired) {
  try {
    runner(['api', '--method', 'PUT', envPath(repo, desired.name), '--input', '-'],
      JSON.stringify({
        wait_timer: desired.wait_timer,
        reviewers: desired.reviewers,
        deployment_branch_policy: desired.deployment_branch_policy,
      }));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).split('\n')[0] };
  }
}

function runApply(desiredList, runner, flags) {
  const resolved = resolveRepoScopes(flags);
  if (resolved.repoScoped) { process.stderr.write(REPO_SCOPED); return 2; }
  if (!resolved.ok) { process.stderr.write(`provision-environments: ${resolved.reason}\n`); return 2; }
  let anyGateless = false;
  for (const repo of resolved.scopes) {
    const bad = invalidRepoReason(repo);
    if (bad) { process.stderr.write(`provision-environments: ${bad}\n`); return 2; }
    for (const desired of desiredList) {
      const r = applyOne(runner, repo, desired);
      if (!r.ok) {
        process.stderr.write(`provision-environments: apply failed for "${desired.name}" on ${repo}: ${r.reason}\n  (gh must be installed, authenticated, and recent; you need admin rights.)\n`);
        return 2;
      }
      process.stdout.write(`apply: provisioned environment "${desired.name}" on ${repo}.\n`);
      if (desired.reviewers.length === 0) { warnEmptyReviewers(desired.name, repo); anyGateless = true; }
    }
  }
  if (anyGateless) {
    // Distinct exit 3 (not 0) so automation cannot read a successful PUT as
    // "gate live": an environment with empty reviewers was provisioned but does
    // NOT require approval. 2 stays reserved for gh/config errors.
    process.stderr.write('PROVISIONED BUT NOT GATING — one or more environments have empty reviewers; the deploy-approval gate is NOT live until reviewer ids are configured in project-manifest.json#github.environments[].reviewers.\n');
    return 3;
  }
  return 0;
}

function writeVerifyReport(cwd, report) {
  const dir = path.join(cwd, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deploy-gate-verify.json'), JSON.stringify(report, null, 2) + '\n');
}

function verifyOne(runner, repo, desired) {
  const got = ghGet(runner, envPath(repo, desired.name));
  if (!got.ok) return { ok: false, reason: got.reason };
  return { ok: true, ...computeDrift(desired, got.data), environment: desired.name, repo };
}

function runVerify(desiredList, runner, cwd, flags) {
  const resolved = resolveRepoScopes(flags);
  if (resolved.repoScoped) { process.stderr.write(REPO_SCOPED); return 2; }
  if (!resolved.ok) { process.stderr.write(`provision-environments: ${resolved.reason}\n`); return 2; }
  const environments = [];
  for (const repo of resolved.scopes) {
    const bad = invalidRepoReason(repo);
    if (bad) { process.stderr.write(`provision-environments: ${bad}\n`); return 2; }
    for (const desired of desiredList) {
      const v = verifyOne(runner, repo, desired);
      if (!v.ok) { process.stderr.write(`provision-environments: verify could not read environment "${desired.name}" on ${repo}: ${v.reason}\n`); return 2; }
      environments.push({ environment: v.environment, repo: v.repo, compliant: v.compliant, drift: v.drift });
    }
  }
  const compliant = environments.every((e) => e.compliant);
  writeVerifyReport(cwd, { compliant, environments });
  process.stdout.write(compliant
    ? 'verify: all configured environments are compliant.\n'
    : `verify: deploy-approval gate DRIFTED (${environments.filter((e) => !e.compliant).length} non-compliant); see specs/reviews/deploy-gate-verify.json.\n`);
  return compliant ? 0 : 1;
}

// Validate reviewers across all configured environments up front (apply/verify).
function reviewerConfigError(github) {
  for (const env of github.environments) {
    const e = reviewerError(env.reviewers);
    if (e) return `environment "${env.name}": ${e}`;
  }
  return null;
}

function run(argv, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const runner = opts.runner || defaultGh;
  const flags = parseFlags(argv);
  const github = readGithub(cwd);
  const environments = (github && Array.isArray(github.environments)) ? github.environments : [];
  if (!environments.length) {
    process.stdout.write('provision-environments: no environments configured in project-manifest.json#github.environments — nothing to provision.\n');
    return 0;
  }
  const nameBad = nameConfigError(environments);
  if (nameBad) { process.stderr.write(`provision-environments: ${nameBad}\n`); return 2; }
  if (flags.mode !== 'plan') {
    const bad = reviewerConfigError(github);
    if (bad) { process.stderr.write(`provision-environments: ${bad}\n`); return 2; }
  }
  const desiredList = environments.map(buildDesiredEnvironment);
  if (flags.mode === 'apply') return runApply(desiredList, runner, flags);
  if (flags.mode === 'verify') return runVerify(desiredList, runner, cwd, flags);
  return runPlan(desiredList, runner, flags);
}

module.exports = { buildDesiredEnvironment, reviewerError, planDiff, computeDrift, run };

if (require.main === module) process.exit(run(process.argv.slice(2), {}));
