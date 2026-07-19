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
