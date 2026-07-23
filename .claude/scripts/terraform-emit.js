#!/usr/bin/env node

'use strict';

// C4 — emit the branch-protection ruleset and deployment-approval environments as
// Terraform, from the SAME project-manifest.json#github spec the imperative
// provisioners read.
//
// Why: the GitHub Terraform provider already does declaratively what
// provision-protection.js and provision-environments.js hand-roll, including drift
// detection — `terraform plan` reports drift natively, which is what those scripts'
// --verify modes re-implement by hand.
//
// What is NOT replaced: fleet discovery. Terraform owns the ruleset definitions;
// fleet.json still supplies which repos exist. Terraform for policy + scripts for
// dynamic repo discovery is the recognised hybrid, not something to collapse.
//
//   node .claude/scripts/terraform-emit.js [--root <dir>] [--fleet <fleet.json>] [--out <file>]
//
// Emitting only. It never runs terraform and never touches GitHub: the output is a
// plan input for a human or CI to review and apply.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join('terraform', 'harness-governance.tf');

// Quote a value as an HCL string. Escaping matters: a ruleset or environment name comes
// from config, and an unescaped quote would silently change the meaning of the emitted
// resource rather than fail.
function hcl(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// HCL identifiers allow letters, digits, underscores and dashes; repo names may carry
// dots. Normalised so a valid repo never produces invalid Terraform.
function ident(name) {
  return String(name).replace(/[^A-Za-z0-9_]/g, '_');
}

// The same floor provision-protection.js applies: the scanners must be required checks
// or the ruleset does not actually block anything.
function requiredChecks(github) {
  const checks = Array.isArray(github.required_checks) ? github.required_checks : [];
  const floor = ['gitleaks', 'sast'];
  return [...new Set([...floor, ...checks])].sort();
}

function rulesBlock(github) {
  const approvals = Math.max(1, Number(github.required_approvals) || 1);
  const checks = requiredChecks(github)
    .map((c) => `      required_check {\n        context = ${hcl(c)}\n      }`)
    .join('\n');
  return [
    '  rules {',
    '    creation                = true',
    '    deletion                = true',
    '    non_fast_forward        = true',
    '',
    '    pull_request {',
    `      required_approving_review_count = ${approvals}`,
    `      require_code_owner_review       = ${github.require_code_owner_review !== false}`,
    '      dismiss_stale_reviews_on_push   = true',
    '    }',
    '',
    '    required_status_checks {',
    '      strict_required_status_checks_policy = true',
    checks,
    '    }',
    '  }',
  ].join('\n');
}

function orgRuleset(github) {
  return [
    `resource "github_organization_ruleset" ${hcl(ident(github.ruleset_name || 'harness_baseline_protection'))} {`,
    `  name        = ${hcl(github.ruleset_name || 'harness-baseline-protection')}`,
    '  target      = "branch"',
    '  enforcement = "active"',
    '',
    '  conditions {',
    '    ref_name {',
    `      include = ["refs/heads/${github.default_branch || 'main'}"]`,
    '      exclude = []',
    '    }',
    '    repository_name {',
    '      include = ["~ALL"]',
    '      exclude = []',
    '    }',
    '  }',
    '',
    rulesBlock(github),
    '}',
  ].join('\n');
}

function repoRuleset(github, repo) {
  return [
    `resource "github_repository_ruleset" ${hcl(ident(repo.repo))} {`,
    `  name        = ${hcl(github.ruleset_name || 'harness-baseline-protection')}`,
    `  repository  = ${hcl(repo.repo)}`,
    '  target      = "branch"',
    '  enforcement = "active"',
    '',
    '  conditions {',
    '    ref_name {',
    `      include = ["refs/heads/${github.default_branch || 'main'}"]`,
    '      exclude = []',
    '    }',
    '  }',
    '',
    rulesBlock(github),
    '}',
  ].join('\n');
}

// An environment with no reviewer is not an approval gate. The deploy-gate verifier
// already treats that as a failure; refusing at emit time means Terraform is never
// generated for a gate that could not gate.
function environmentResource(repo, env) {
  const reviewers = Array.isArray(env.reviewers) ? env.reviewers.filter(Boolean) : [];
  if (reviewers.length === 0) {
    throw new Error(
      `terraform-emit: environment "${env.name}" on ${repo.owner}/${repo.repo} has no reviewer — ` +
      'an environment without required reviewers is not an approval gate, so emitting it ' +
      'would provision a gate that cannot gate.'
    );
  }
  const teams = reviewers.map((r) => `    # ${r}`).join('\n');
  return [
    `resource "github_repository_environment" ${hcl(`${ident(repo.repo)}_${ident(env.name)}`)} {`,
    `  environment = ${hcl(env.name)}`,
    `  repository  = ${hcl(repo.repo)}`,
    '',
    '  reviewers {',
    '    # Resolve these to numeric team/user ids in your root module:',
    teams,
    `    teams = [for t in var.${ident(env.name)}_reviewer_teams : t]`,
    '  }',
    '',
    '  deployment_branch_policy {',
    '    protected_branches     = true',
    '    custom_branch_policies = false',
    '  }',
    '}',
  ].join('\n');
}

function header(github) {
  return [
    '# GENERATED by .claude/scripts/terraform-emit.js — do not edit by hand.',
    '# Source of truth: project-manifest.json#github (+ fleet.json for repo discovery).',
    '# Regenerate:  node .claude/scripts/terraform-emit.js',
    '#',
    '# Terraform owns the POLICY. Repo discovery stays with fleet.json, which is the',
    '# recognised hybrid: declarative rulesets, scripted enumeration of what exists.',
    '#',
    `# org: ${github.org}`,
    '',
    'terraform {',
    '  required_providers {',
    '    github = {',
    '      source  = "integrations/github"',
    '      version = "~> 6.0"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

function emitTerraform({ github, repos = [] }) {
  if (!github || !String(github.org || '').trim()) {
    throw new Error('terraform-emit: project-manifest.json#github.org is empty — a ruleset with no owner targets nothing');
  }
  const parts = [header(github)];
  if ((github.ruleset_scope || 'org') === 'org') {
    parts.push(orgRuleset(github));
  } else {
    for (const r of repos) parts.push(repoRuleset(github, r));
  }
  for (const r of repos) {
    for (const env of github.environments || []) parts.push(environmentResource(r, env));
  }
  return parts.join('\n\n') + '\n';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

function main(argv = process.argv.slice(2)) {
  const root = argValue(argv, '--root') || REPO_ROOT;
  const pm = readJson(path.join(root, 'project-manifest.json'));
  if (!pm || !pm.github) {
    console.error('terraform-emit: no project-manifest.json#github block — nothing to emit');
    return 2;
  }
  const fleetPath = argValue(argv, '--fleet') || path.join(root, 'fleet.json');
  const fleet = readJson(fleetPath);
  const repos = fleet && Array.isArray(fleet.repos) ? fleet.repos : [];

  let out;
  try {
    out = emitTerraform({ github: pm.github, repos });
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  const outFile = path.join(root, argValue(argv, '--out') || DEFAULT_OUT);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  console.log(
    `terraform-emit: ${(pm.github.ruleset_scope || 'org')}-scope ruleset + ` +
    `${repos.length * (pm.github.environments || []).length} environment(s) -> ${outFile}`
  );
  console.log('  review, then: terraform plan   (plan IS the drift report — see C4)');
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { emitTerraform, hcl, ident, requiredChecks };
