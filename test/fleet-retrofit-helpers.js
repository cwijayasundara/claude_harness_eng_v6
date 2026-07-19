'use strict';

// Shared helpers for the fleet-retrofit runner tests (not a *.test.js, so the
// node:test glob does not run it as a suite). The integration tests round-trip
// the REAL Inc 2/3 provisioners: fleet-retrofit invokes provision-protection /
// provision-environments run() with an injected gh runner, and this stub answers
// the provisioners' actual gh api calls so they produce real exit codes — no
// hand-built provisioner double.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(REPO_ROOT, '.claude', 'scripts');
const { buildDesiredRuleset } = require(path.join(SCRIPTS, 'provision-protection'));
const NOW = '2026-07-19T00:00:00.000Z';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// A default operator config: one org, the secure-baseline ruleset, one
// production environment with a real reviewer id (so the approval-gate floor is
// satisfied for a 'gated' repo).
function defaultGithub() {
  return {
    org: 'acme',
    ruleset_name: 'secure-baseline',
    required_checks: ['gitleaks', 'sast'],
    required_approvals: 1,
    require_code_owner_review: true,
    environments: [{ name: 'production', wait_timer: 0, reviewers: [{ type: 'Team', id: 42 }], protected_branches: true }],
  };
}

// A tmp operator cwd carrying project-manifest.json#github (the single config the
// provisioners read). Returns the cwd.
function operatorCwd(github) {
  const cwd = tmp('fr-op-');
  fs.writeFileSync(path.join(cwd, 'project-manifest.json'), JSON.stringify({ github: github || defaultGithub() }));
  return cwd;
}

function writeFleet(cwd, repos, org) {
  const file = path.join(cwd, 'fleet.json');
  fs.writeFileSync(file, JSON.stringify({ org: org || 'acme', repos }));
  return file;
}

// The live "Get an environment" GET shape (protection_rules[] nested) that
// normalizeLiveEnvironment folds back to the canonical flat form — built from the
// env config so a 'gated' repo verifies compliant.
function liveEnv(envCfg) {
  return {
    name: envCfg.name,
    protection_rules: [
      { type: 'wait_timer', wait_timer: Number(envCfg.wait_timer) || 0 },
      { type: 'required_reviewers', reviewers: (envCfg.reviewers || []).map((r) => ({ type: r.type, reviewer: { id: r.id } })) },
    ],
    deployment_branch_policy: { protected_branches: envCfg.protected_branches !== false, custom_branch_policies: false },
  };
}

function envName(key) {
  const m = key.match(/\/environments\/([^\s]+)/);
  return m ? m[1] : null;
}

// A gh stub over a fleet: `outcomes` maps an "owner/repo" slug to 'gated' or
// 'throw'. A 'gated' repo gets a compliant live ruleset (echo the desired spec)
// and a compliant live environment; a 'throw' repo makes every gh call for it
// error (simulating no admin / 404) so the provisioners return their error code.
// Records every call so a test can assert isolation + real per-repo argv.
function makeGh(github, outcomes, calls) {
  const RN = github.ruleset_name;
  const desiredRs = buildDesiredRuleset(github, { orgScope: false });
  const envByName = {};
  for (const e of github.environments || []) envByName[e.name] = e;
  return function gh(args) {
    const key = args.join(' ');
    if (calls) calls.push(key);
    const slug = Object.keys(outcomes).find((s) => key.includes('repos/' + s + '/'));
    if (!slug) throw new Error('unexpected gh call (no fleet repo matched): ' + key);
    if (outcomes[slug] === 'throw') throw new Error('gh: Not Found (HTTP 404)');
    if (key.includes('/rulesets')) {
      if (key.includes('--method')) return '';                       // PUT/POST apply ok
      if (/\/rulesets\/\d+/.test(key)) return JSON.stringify(desiredRs); // GET detail (compliant)
      return JSON.stringify([{ name: RN, id: 100 }]);                // list -> match by name
    }
    if (key.includes('/environments/')) {
      if (key.includes('--method')) return '';                       // PUT apply ok
      const e = envByName[envName(key)];
      if (!e) throw new Error('gh: Not Found (HTTP 404)');
      return JSON.stringify(liveEnv(e));                             // GET (compliant)
    }
    throw new Error('unexpected gh call: ' + key);
  };
}

function capture(fn) {
  const out = { stdout: '', stderr: '' };
  const ow = process.stdout.write; const oe = process.stderr.write;
  process.stdout.write = (c) => { out.stdout += c; return true; };
  process.stderr.write = (c) => { out.stderr += c; return true; };
  try { out.code = fn(); } finally { process.stdout.write = ow; process.stderr.write = oe; }
  return out;
}

function readReport(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

module.exports = {
  REPO_ROOT, SCRIPTS, NOW, tmp, defaultGithub, operatorCwd, writeFleet, makeGh, capture, readReport,
};
