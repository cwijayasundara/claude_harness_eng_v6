'use strict';

// C4: the branch-protection ruleset and deployment-approval environments are emitted as
// Terraform, from the SAME project-manifest.json#github spec the imperative provisioners
// read. Terraform's provider already does declaratively what provision-protection.js and
// provision-environments.js hand-roll — including drift detection, which `terraform plan`
// gives for free and which our --verify modes re-implement.
//
// Fleet discovery is NOT replaced: Terraform owns the ruleset definitions, fleet.json
// still supplies which repos exist. That hybrid is the recognised pattern.

const { test } = require('node:test');
const assert = require('node:assert');
const { emitTerraform, hcl } = require('../.claude/scripts/terraform-emit');

const GITHUB = {
  org: 'acme',
  default_branch: 'main',
  required_checks: ['gitleaks', 'sast'],
  required_approvals: 2,
  require_code_owner_review: true,
  ruleset_scope: 'org',
  ruleset_name: 'harness-baseline-protection',
  environments: [{ name: 'production', reviewers: ['acme/security'] }],
};

test('hcl escapes quotes and backslashes so a crafted name cannot break out of a string', () => {
  assert.strictEqual(hcl('a"b'), '"a\\"b"');
  assert.strictEqual(hcl('a\\b'), '"a\\\\b"');
});

test('org scope emits an organization ruleset, not a per-repo one', () => {
  const out = emitTerraform({ github: GITHUB, repos: [] });
  assert.match(out, /resource "github_organization_ruleset"/);
  assert.doesNotMatch(out, /resource "github_repository_ruleset"/);
});

test('repo scope emits one repository ruleset per fleet repo', () => {
  const out = emitTerraform({
    github: { ...GITHUB, ruleset_scope: 'repo' },
    repos: [{ owner: 'acme', repo: 'alpha' }, { owner: 'acme', repo: 'beta' }],
  });
  assert.match(out, /resource "github_repository_ruleset" "alpha"/);
  assert.match(out, /resource "github_repository_ruleset" "beta"/);
  assert.doesNotMatch(out, /resource "github_organization_ruleset"/);
});

test('the required checks from the manifest reach the ruleset', () => {
  const out = emitTerraform({ github: GITHUB, repos: [] });
  assert.match(out, /context\s*=\s*"gitleaks"/);
  assert.match(out, /context\s*=\s*"sast"/);
});

test('approval count and code-owner review carry through', () => {
  const out = emitTerraform({ github: GITHUB, repos: [] });
  assert.match(out, /required_approving_review_count\s*=\s*2/);
  assert.match(out, /require_code_owner_review\s*=\s*true/);
});

test('force-push and deletion are blocked, matching the imperative provisioner', () => {
  const out = emitTerraform({ github: GITHUB, repos: [] });
  assert.match(out, /non_fast_forward\s*=\s*true/);
  assert.match(out, /deletion\s*=\s*true/);
});

test('an environment with reviewers becomes a github_repository_environment', () => {
  const out = emitTerraform({ github: GITHUB, repos: [{ owner: 'acme', repo: 'alpha' }] });
  assert.match(out, /resource "github_repository_environment" "alpha_production"/);
  assert.match(out, /reviewers/);
});

test('the approval-gate floor is enforced at emit time, not left to review', () => {
  // The same floor the deploy-gate verifier applies: an environment with no reviewer
  // is not an approval gate at all, so emitting one would produce Terraform that
  // provisions a gate which cannot gate.
  assert.throws(
    () => emitTerraform({ github: { ...GITHUB, environments: [{ name: 'prod', reviewers: [] }] }, repos: [{ owner: 'acme', repo: 'a' }] }),
    /reviewer/i);
});

test('an absent org is refused rather than emitting an unowned ruleset', () => {
  assert.throws(() => emitTerraform({ github: { ...GITHUB, org: '' }, repos: [] }), /org/i,
    'emitting a ruleset with no owner would silently target nothing');
});

test('output is deterministic — same input, byte-identical output', () => {
  const a = emitTerraform({ github: GITHUB, repos: [{ owner: 'acme', repo: 'alpha' }] });
  const b = emitTerraform({ github: GITHUB, repos: [{ owner: 'acme', repo: 'alpha' }] });
  assert.strictEqual(a, b, 'non-determinism would show as spurious drift in terraform plan');
});

test('resource names are sanitised so a repo with dots or dashes stays valid HCL', () => {
  const out = emitTerraform({
    github: { ...GITHUB, ruleset_scope: 'repo' },
    repos: [{ owner: 'acme', repo: 'my.svc-2' }],
  });
  assert.match(out, /resource "github_repository_ruleset" "my_svc_2"/);
});
