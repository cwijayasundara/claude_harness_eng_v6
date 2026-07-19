'use strict';

// Whole-branch-review hardening for the CODEOWNERS generator + scaffold github
// defaults (Increment 2): VULN-003 owner/path injection, VULN-005 partial-block
// deep-merge, CR-002 loud scaffold-time notice when review is required but no
// owners are set.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { renderCodeowners } = require('../.claude/scripts/generate-codeowners');
const { applyGithubDefault, materializeCodeowners } = require('../.claude/scripts/scaffold-security-baseline');

// --- VULN-003: owner/path values cannot smuggle extra CODEOWNERS rules ---------

test('VULN-003: a newline-injecting owner is rejected, not rendered', () => {
  assert.throws(
    () => renderCodeowners({ default_owners: ['@team\n* @attacker'] }),
    /invalid CODEOWNERS owner/,
  );
});

test('VULN-003: an owner with whitespace / a bogus token is rejected', () => {
  assert.throws(() => renderCodeowners({ default_owners: ['@a @b'] }), /invalid CODEOWNERS owner/);
  assert.throws(() => renderCodeowners({ default_owners: ['not-an-owner'] }), /invalid CODEOWNERS owner/);
});

test('VULN-003: a path key with a newline is rejected', () => {
  assert.throws(
    () => renderCodeowners({ default_owners: ['@org/team'], path_owners: { '/x/\n* @attacker': ['@org/team'] } }),
    /invalid CODEOWNERS path/,
  );
});

test('VULN-003: valid @user, @org/team, and email owners still render', () => {
  const out = renderCodeowners({ default_owners: ['@user', '@org/team', 'dev@example.com'] });
  assert.match(out, /^\* @user @org\/team dev@example\.com$/m);
});

// --- VULN-005: a partial github block still inherits the strong defaults --------

test('VULN-005: a partial manifest.github {org} deep-merges the strong security defaults', () => {
  const manifest = { name: 'p', github: { org: 'acme' } };
  applyGithubDefault(manifest, {});
  assert.strictEqual(manifest.github.org, 'acme', 'operator value preserved');
  assert.strictEqual(manifest.github.required_approvals, 1);
  assert.strictEqual(manifest.github.require_code_owner_review, true);
  assert.deepStrictEqual(manifest.github.required_checks, ['gitleaks', 'sast']);
  assert.strictEqual(manifest.github.ruleset_name, 'harness-baseline-protection');
});

test('VULN-005: an operator override on a security field is not clobbered by defaults', () => {
  const manifest = { name: 'p', github: { org: 'acme', required_approvals: 2 } };
  applyGithubDefault(manifest, {});
  assert.strictEqual(manifest.github.required_approvals, 2);
});

// --- CR-002: loud notice when review is required but owners are empty ----------

function mkManifest(github) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowners-scaffold-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({ name: 'p', github }, null, 2));
  return dir;
}

function captureStderr(fn) {
  let err = '';
  const oe = process.stderr.write;
  process.stderr.write = (c) => { err += c; return true; };
  try { fn(); } finally { process.stderr.write = oe; }
  return err;
}

test('CR-002: require_code_owner_review:true + empty owners emits an ACTION REQUIRED notice', () => {
  const dir = mkManifest({ require_code_owner_review: true, default_owners: [] });
  const err = captureStderr(() => materializeCodeowners(dir));
  assert.match(err, /ACTION REQUIRED/);
  assert.strictEqual(fs.existsSync(path.join(dir, '.github', 'CODEOWNERS')), false, 'still writes no empty CODEOWNERS');
});

test('CR-002: no notice when owners are configured', () => {
  const dir = mkManifest({ require_code_owner_review: true, default_owners: ['@org/team'] });
  const err = captureStderr(() => materializeCodeowners(dir));
  assert.doesNotMatch(err, /ACTION REQUIRED/);
  assert.ok(fs.existsSync(path.join(dir, '.github', 'CODEOWNERS')));
});

test('CR-002: no notice when code-owner review is not required', () => {
  const dir = mkManifest({ require_code_owner_review: false, default_owners: [] });
  const err = captureStderr(() => materializeCodeowners(dir));
  assert.doesNotMatch(err, /ACTION REQUIRED/);
});
