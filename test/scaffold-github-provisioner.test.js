'use strict';

// Increment 2 scaffold round-trip: a scaffolded project gets the `github`
// manifest block (empty org/default_owners by default — no literals), and a real
// .github/CODEOWNERS when default_owners is configured.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyScaffold } = require('../.claude/scripts/scaffold-apply');

const PLUGIN_SOURCE = path.resolve(__dirname, '..', '.claude');

const BASE_PROFILE = {
  name: 'sample-cli',
  description: 'A tiny Node CLI utility.',
  stack: { backend: { language: 'typescript' }, frontend: null, database: null },
  projectType: 'D', verificationMode: 'C', modelTier: 'balanced', frameworkPacks: [],
};

function scaffold(profile) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-gh-'));
  const target = path.join(workDir, 'project');
  const profilePath = path.join(workDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(profile));
  applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });
  return { workDir, target };
}

test('scaffold writes a github block with empty org/default_owners by default (no literals)', () => {
  const { workDir, target } = scaffold(BASE_PROFILE);
  try {
    const m = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    assert.ok(m.github, 'manifest must carry a github section');
    assert.strictEqual(m.github.org, '');
    assert.deepStrictEqual(m.github.default_owners, []);
    assert.strictEqual(m.github.ruleset_name, 'harness-baseline-protection');
    assert.deepStrictEqual(m.github.required_checks, ['gitleaks', 'sast']);
    assert.strictEqual(m.github.require_code_owner_review, true);
    // empty owners ⇒ no CODEOWNERS file materialized
    assert.strictEqual(fs.existsSync(path.join(target, '.github', 'CODEOWNERS')), false);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('scaffold writes the default production environment; a partial github block still inherits it (C1)', () => {
  const { workDir, target } = scaffold({ ...BASE_PROFILE, github: { org: 'acme' } });
  try {
    const m = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    assert.ok(Array.isArray(m.github.environments), 'environments must be inherited into a partial github block');
    assert.strictEqual(m.github.environments[0].name, 'production');
    assert.deepStrictEqual(m.github.environments[0].reviewers, []);
    assert.strictEqual(m.github.environments[0].protected_branches, true);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('scaffold materializes an environment-gated deploy.yml with the configured env name (C3, real round-trip)', () => {
  const { workDir, target } = scaffold({ ...BASE_PROFILE, github: { environments: [{ name: 'prod-eu', reviewers: [], protected_branches: true }] } });
  try {
    const deploy = path.join(target, '.github', 'workflows', 'deploy.yml');
    assert.ok(fs.existsSync(deploy), 'deploy.yml must be materialized when environments are configured');
    const text = fs.readFileSync(deploy, 'utf8');
    assert.match(text, /^\s*environment:\s*prod-eu$/m, 'environment: stamped from config, not a literal');
    assert.match(text, /workflow_dispatch/, 'manual-dispatch only — never auto-deploys');
    assert.match(text, /uses: actions\/checkout@[0-9a-f]{40}/, 'checkout pinned to a SHA');
    assert.match(text, /exit 1/, 'placeholder deploy step is inert (fails until wired)');
    assert.doesNotMatch(text, /\bacme\b|\bproduction\b/, 'no stale/client literals left in the env gate');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('scaffold materializes .github/CODEOWNERS when default_owners is configured', () => {
  const { workDir, target } = scaffold({
    ...BASE_PROFILE,
    github: { org: 'acme', default_owners: ['@acme/platform', '@acme/security'] },
  });
  try {
    const m = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    assert.strictEqual(m.github.org, 'acme');
    assert.deepStrictEqual(m.github.default_owners, ['@acme/platform', '@acme/security']);
    // profile.github merges over defaults — the unspecified keys keep their defaults
    assert.strictEqual(m.github.ruleset_name, 'harness-baseline-protection');
    const codeowners = path.join(target, '.github', 'CODEOWNERS');
    assert.ok(fs.existsSync(codeowners), 'CODEOWNERS must be materialized when owners are set');
    assert.match(fs.readFileSync(codeowners, 'utf8'), /^\* @acme\/platform @acme\/security$/m);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
