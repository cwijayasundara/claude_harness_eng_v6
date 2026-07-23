'use strict';

// C4 part 2: drift detection comes from `terraform plan` instead of hand-rolled GET +
// diff. Terraform already computes desired-vs-live; -detailed-exitcode reports it as
// 0 = no changes, 2 = changes pending (drift), 1 = error.
//
// The output must keep the SAME contract the imperative verifiers emit, because
// attestation-io#classifyVerify and fleet-retrofit both read it: `compliant` must be a
// BOOLEAN (a non-boolean is classified "invalid"), plus a structured drift[].
//
// Every non-success path must land on compliant:false. A drift reporter that answers
// "compliant" when it could not actually check is the exact failure this harness keeps
// finding elsewhere.

const { test } = require('node:test');
const assert = require('node:assert');
const { verifyWithTerraform, parseDriftResources } = require('../.claude/scripts/terraform-verify');

const PLAN_WITH_DRIFT = `
Terraform will perform the following actions:

  # github_organization_ruleset.harness_baseline_protection will be updated in-place
  ~ resource "github_organization_ruleset" "harness_baseline_protection" {
        id = "12345"
    }

  # github_repository_environment.alpha_production will be created
  + resource "github_repository_environment" "alpha_production" {
    }

Plan: 1 to add, 1 to change, 0 to destroy.
`;

const runner = (code, stdout = '', stderr = '') => () => ({ status: code, stdout, stderr });

test('exit 0 (no changes) is compliant with empty drift', () => {
  const r = verifyWithTerraform({ dir: '/tf', run: runner(0, 'No changes. Your infrastructure matches the configuration.') });
  assert.strictEqual(r.compliant, true);
  assert.deepStrictEqual(r.drift, []);
});

test('exit 2 (changes pending) is drift, not compliant', () => {
  const r = verifyWithTerraform({ dir: '/tf', run: runner(2, PLAN_WITH_DRIFT) });
  assert.strictEqual(r.compliant, false);
  assert.ok(r.drift.length >= 2, 'each pending change is a drift entry');
});

test('drift entries name the resources terraform would change', () => {
  const r = verifyWithTerraform({ dir: '/tf', run: runner(2, PLAN_WITH_DRIFT) });
  const names = r.drift.map((d) => d.resource);
  assert.ok(names.includes('github_organization_ruleset.harness_baseline_protection'));
  assert.ok(names.includes('github_repository_environment.alpha_production'));
});

test('drift entries record the action so update and create are distinguishable', () => {
  const r = verifyWithTerraform({ dir: '/tf', run: runner(2, PLAN_WITH_DRIFT) });
  const byName = Object.fromEntries(r.drift.map((d) => [d.resource, d.action]));
  assert.strictEqual(byName['github_organization_ruleset.harness_baseline_protection'], 'update');
  assert.strictEqual(byName['github_repository_environment.alpha_production'], 'create');
});

test('exit 1 (terraform error) is NOT compliant', () => {
  // A genuine plan failure, not an init gap — "could not load plugin" IS an init gap
  // and is classified unprovisioned by the test below.
  const r = verifyWithTerraform({ dir: '/tf', run: runner(1, '', 'Error: Invalid provider configuration for github') });
  assert.strictEqual(r.compliant, false, 'an errored plan proves nothing and must never read as compliant');
  assert.strictEqual(r.status, 'error');
});

test('terraform not installed is reported, never a vacuous pass', () => {
  const r = verifyWithTerraform({ dir: '/tf', run: () => { const e = new Error('spawn terraform ENOENT'); e.code = 'ENOENT'; throw e; } });
  assert.strictEqual(r.compliant, false);
  assert.strictEqual(r.status, 'unprovisioned');
  assert.match(r.reason, /terraform/i);
});

test('an uninitialised working directory is reported as unprovisioned, not drift', () => {
  const r = verifyWithTerraform({
    dir: '/tf',
    run: runner(1, '', 'Error: Could not load plugin\n\nPlease run "terraform init"'),
  });
  assert.strictEqual(r.status, 'unprovisioned');
  assert.strictEqual(r.compliant, false);
});

test('compliant is always a boolean — the contract attestation classifies on', () => {
  for (const r of [
    verifyWithTerraform({ dir: '/tf', run: runner(0) }),
    verifyWithTerraform({ dir: '/tf', run: runner(2, PLAN_WITH_DRIFT) }),
    verifyWithTerraform({ dir: '/tf', run: runner(1, '', 'boom') }),
  ]) {
    assert.strictEqual(typeof r.compliant, 'boolean',
      'a non-boolean is classified "invalid" by attestation-io and loses the signal');
  }
});

test('parseDriftResources ignores prose and only takes resource lines', () => {
  const drift = parseDriftResources('Plan: 3 to add.\nSome unrelated line\n  # github_x.y will be destroyed');
  assert.deepStrictEqual(drift, [{ resource: 'github_x.y', action: 'destroy' }]);
});

test('a plan reporting changes but naming none still fails closed', () => {
  const r = verifyWithTerraform({ dir: '/tf', run: runner(2, 'Plan: 1 to add, 0 to change, 0 to destroy.') });
  assert.strictEqual(r.compliant, false, 'exit 2 means drift even when the resource lines cannot be parsed');
  assert.ok(r.reason, 'and it must say why rather than showing an empty drift list');
});
