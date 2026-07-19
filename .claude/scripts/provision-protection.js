#!/usr/bin/env node

'use strict';

// Branch-protection provisioner (Increment 2). Provisions the platform-level
// enforcement Increment 1's scanners need to actually BLOCK a non-compliant PR:
// a GitHub org-level Ruleset (primary) or per-repo ruleset (fallback) that marks
// the gitleaks + sast checks required and requires code-owner review.
//
//   plan (default) : GET the live ruleset by name, diff vs the desired spec,
//                    print create/update/compliant + the org-admin note. Exit 0.
//   --apply        : idempotent. List rulesets, match by ruleset_name, POST to
//                    create or PUT .../rulesets/{id} to update. Org mode = one
//                    call; repo mode iterates --repo <owner/repo> / --fleet f.json.
//   --verify       : GET the live ruleset, report compliant vs structured drift[],
//                    write specs/reviews/branch-protection-verify.json, exit
//                    non-zero on drift so CI / an admin can gate on it.
//
// Every identifier (org, repo, checks, owners) comes from project-manifest.json
// #github — no client literals here. gitleaks + sast + >=1 approval are an
// ABSOLUTE floor unioned in regardless of config (config is additive, never
// subtractive). gh runs through an injected runner (execFileSync('gh', argv) with
// literal argv) and every call is try/catch→result-object so it never throws.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { compareRulesets, planDiff, computeDrift } = require('./ruleset-diff');

function defaultGh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input });
}

// --- desired spec (built from config; documented GitHub rulesets schema) ------

// Security floor: gitleaks + sast are ALWAYS required, appended to whatever the
// config lists (order-preserving union). Config can add checks, never drop these.
const REQUIRED_FLOOR = ['gitleaks', 'sast'];

function floorChecks(configured) {
  const base = Array.isArray(configured) ? configured.slice() : [];
  for (const must of REQUIRED_FLOOR) if (!base.includes(must)) base.push(must);
  return base;
}

// The rule set, with the security floor enforced independent of config: >=1
// approval and gitleaks+sast required, whatever the manifest asked for.
function desiredRules(github) {
  return [
    { type: 'pull_request',
      parameters: {
        required_approving_review_count: Math.max(1, Number(github.required_approvals) || 1),
        require_code_owner_review: github.require_code_owner_review !== false,
        dismiss_stale_reviews_on_push: true,
      } },
    { type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: floorChecks(github.required_checks).map((context) => ({ context })),
      } },
    { type: 'non_fast_forward' },
    { type: 'deletion' },
  ];
}

// orgScope (default: config ruleset_scope !== 'repo') decides whether the ruleset
// carries a repository_name target. An org-level ruleset REQUIRES one (GitHub 422s
// without it); a repo-level ruleset must OMIT it (422s if present).
function buildDesiredRuleset(github, opts = {}) {
  const orgScope = opts.orgScope !== undefined ? opts.orgScope : (github.ruleset_scope !== 'repo');
  const conditions = { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } };
  if (orgScope) {
    conditions.repository_name = { include: [github.target_repos || '~ALL'], exclude: [] };
  }
  // enforce_admins:true ⇒ empty bypass_actors (admins cannot bypass). A bypass
  // entry needs an actor id — inherently client-specific — so the only literal-free
  // representation is the empty, no-bypass set.
  return {
    name: github.ruleset_name,
    target: 'branch',
    enforcement: 'active',
    conditions,
    rules: desiredRules(github),
    bypass_actors: [],
  };
}

// --- gh access (result-object, never throws) ---------------------------------

function ghJson(runner, args, input) {
  try {
    const raw = runner(args, input);
    return { ok: true, data: input === undefined ? JSON.parse(raw) : null };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).split('\n')[0] };
  }
}

// Reject config values that would manipulate the gh API path (traversal / extra
// segments). org/owner/repo are single path segments of [A-Za-z0-9._-], no "..".
const SEGMENT = /^[A-Za-z0-9._-]+$/;
function validSegment(s) { return typeof s === 'string' && SEGMENT.test(s) && !s.includes('..'); }

function invalidScopeReason(scope) {
  if (scope.repo !== undefined) {
    const parts = String(scope.repo).split('/');
    if (parts.length !== 2 || !parts.every(validSegment)) {
      return `invalid repo "${scope.repo}" (expected owner/repo, chars [A-Za-z0-9._-], no "..")`;
    }
  } else if (!validSegment(scope.org)) {
    return `invalid org "${scope.org}" (chars [A-Za-z0-9._-], no "..")`;
  }
  return null;
}

function rulesetsPath(scope) {
  return scope.repo ? `repos/${scope.repo}/rulesets` : `orgs/${scope.org}/rulesets`;
}

// List rulesets (paginated — an org can have >30) and match by name. Warns loudly
// when more than one shares the configured name before picking the first.
function findRuleset(runner, scope, name) {
  const res = ghJson(runner, ['api', '--paginate', rulesetsPath(scope)]);
  if (!res.ok) return res;
  const matches = (Array.isArray(res.data) ? res.data : []).filter((r) => r && r.name === name);
  if (matches.length > 1) {
    process.stderr.write(`provision-protection: WARNING: ${matches.length} rulesets named "${name}" on ${scope.repo || scope.org}; using the first (id ${matches[0].id}).\n`);
  }
  return { ok: true, id: matches.length ? matches[0].id : null };
}

function upsert(runner, scope, desired) {
  const found = findRuleset(runner, scope, desired.name);
  if (!found.ok) return found;
  const body = JSON.stringify(desired);
  const base = rulesetsPath(scope);
  const args = found.id
    ? ['api', '--method', 'PUT', `${base}/${found.id}`, '--input', '-']
    : ['api', '--method', 'POST', base, '--input', '-'];
  try {
    runner(args, body);
    return { ok: true, mode: found.id ? 'update' : 'create', id: found.id };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).split('\n')[0] };
  }
}

// --- manifest + scope resolution ---------------------------------------------

function readGithub(cwd) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cwd, 'project-manifest.json'), 'utf8'));
    return (m && m.github) || null;
  } catch (_) { return null; }
}

function resolveScopes(github, flags) {
  if (flags.repo) return { ok: true, scopes: [{ repo: flags.repo }] };
  if (flags.fleet) {
    try {
      const reg = JSON.parse(fs.readFileSync(flags.fleet, 'utf8'));
      return { ok: true, scopes: (reg.repos || []).map((r) => ({ repo: `${r.owner}/${r.repo}` })) };
    } catch (err) {
      return { ok: false, reason: `cannot read fleet registry ${flags.fleet}: ${String((err && err.message) || err).split('\n')[0]}` };
    }
  }
  return { ok: true, scopes: [{ org: github.org }] };
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

function runPlan(github, desired, runner) {
  if (!github.org) {
    process.stdout.write(`plan: github.org is unset — cannot diff against a live ruleset.\n  desired ruleset "${desired.name}" would be created once org is set.\n${ADMIN_NOTE}`);
    return 0;
  }
  const found = findRuleset(runner, { org: github.org }, desired.name);
  if (!found.ok) { process.stdout.write(`plan: could not read live rulesets (${found.reason}). This is a preview only.\n${ADMIN_NOTE}`); return 0; }
  let live = null;
  if (found.id) {
    const detail = ghJson(runner, ['api', `orgs/${github.org}/rulesets/${found.id}`]);
    if (!detail.ok) { process.stdout.write(`plan: could not read ruleset ${found.id} (${detail.reason}).\n${ADMIN_NOTE}`); return 0; }
    live = detail.data;
  }
  const res = planDiff(desired, live);
  if (res.action === 'create') process.stdout.write(`plan: would CREATE ruleset "${desired.name}" (${github.ruleset_scope} scope).\n`);
  else if (res.action === 'compliant') process.stdout.write(`plan: ruleset "${desired.name}" is already compliant.\n`);
  else process.stdout.write(`plan: would UPDATE ruleset "${desired.name}":\n${res.changes.map((c) => `  - ${c.field}: ${JSON.stringify(c.actual)} -> ${JSON.stringify(c.expected)}`).join('\n')}\n`);
  process.stdout.write(ADMIN_NOTE);
  return 0;
}

function runApply(github, desired, runner, flags) {
  const resolved = resolveScopes(github, flags);
  if (!resolved.ok) { process.stderr.write(`provision-protection: ${resolved.reason}\n`); return 2; }
  for (const scope of resolved.scopes) {
    if (scope.org !== undefined && !scope.org) {
      process.stderr.write('provision-protection: github.org is empty — set it (org scope) or pass --repo/--fleet (repo scope).\n');
      return 2;
    }
    const bad = invalidScopeReason(scope);
    if (bad) { process.stderr.write(`provision-protection: ${bad}\n`); return 2; }
    const r = upsert(runner, scope, desired);
    if (!r.ok) {
      process.stderr.write(`provision-protection: apply failed for ${scope.repo || scope.org}: ${r.reason}\n  (gh must be installed, authenticated, and recent; you need admin rights.)\n`);
      return 2;
    }
    process.stdout.write(`apply: ${r.mode === 'create' ? 'created' : `updated (id ${r.id})`} ruleset "${desired.name}" on ${scope.repo || scope.org}. Merge-blocking is now live.\n`);
  }
  return 0;
}

function writeVerifyReport(cwd, report) {
  const dir = path.join(cwd, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'branch-protection-verify.json'), JSON.stringify(report, null, 2) + '\n');
}

function runVerify(github, desired, runner, cwd, flags) {
  const scope = flags.repo ? { repo: flags.repo } : { org: github.org };
  if (scope.org !== undefined && !scope.org) {
    process.stderr.write('provision-protection: github.org is empty — set it or pass --repo.\n');
    return 2;
  }
  const bad = invalidScopeReason(scope);
  if (bad) { process.stderr.write(`provision-protection: ${bad}\n`); return 2; }
  const found = findRuleset(runner, scope, desired.name);
  if (!found.ok) { process.stderr.write(`provision-protection: verify could not read rulesets: ${found.reason}\n`); return 2; }
  let report;
  if (!found.id) {
    report = { compliant: false, drift: [{ rule: 'ruleset', field: 'presence', expected: 'present', actual: 'absent' }], ruleset: desired.name, target: scope.repo || scope.org };
  } else {
    const detail = ghJson(runner, ['api', `${rulesetsPath(scope)}/${found.id}`]);
    if (!detail.ok) { process.stderr.write(`provision-protection: verify could not read ruleset ${found.id}: ${detail.reason}\n`); return 2; }
    report = { ...computeDrift(desired, detail.data), ruleset: desired.name, target: scope.repo || scope.org };
  }
  writeVerifyReport(cwd, report);
  process.stdout.write(report.compliant
    ? `verify: ruleset "${desired.name}" is compliant.\n`
    : `verify: ruleset "${desired.name}" DRIFTED (${report.drift.length} finding(s)); see specs/reviews/branch-protection-verify.json.\n`);
  return report.compliant ? 0 : 1;
}

function run(argv, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const runner = opts.runner || defaultGh;
  const flags = parseFlags(argv);
  const github = readGithub(cwd);
  if (!github) {
    process.stdout.write('provision-protection: no github section in project-manifest.json — not configured. Nothing to provision.\n');
    return 0;
  }
  // Repo scope (via --repo/--fleet) omits the repository_name target; org scope includes it.
  const orgScope = !flags.repo && !flags.fleet;
  const desired = buildDesiredRuleset(github, { orgScope });
  if (flags.mode === 'apply') return runApply(github, desired, runner, flags);
  if (flags.mode === 'verify') return runVerify(github, desired, runner, cwd, flags);
  return runPlan(github, desired, runner);
}

module.exports = { buildDesiredRuleset, compareRulesets, planDiff, computeDrift, run };

if (require.main === module) process.exit(run(process.argv.slice(2), {}));
