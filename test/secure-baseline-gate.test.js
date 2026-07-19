'use strict';

// Gate-level coverage for the C3 presence invariant: it passes in-process on a
// correctly-scaffolded repo, and BLOCKs (process.exit(1) via failBlock) in a
// child process when the guard is missing. Proves the gate orchestration + the
// failBlock path, not just the pure wiringViolations logic.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { applyScaffold } = require('../.claude/scripts/scaffold-apply');
const strict = require('../.claude/hooks/lib/gates-strict');

const BASE_PROFILE = {
  name: 'secbaseline-gate-probe', description: 'gate probe',
  stack: { backend: null, frontend: null, database: null },
  projectType: 'D', verificationMode: 'C', modelTier: 'balanced', tracker: 'A',
  frameworkPacks: [], lsp: [],
  // Increment 2 (C4): the wiring invariant now also requires .github/CODEOWNERS
  // when github.require_code_owner_review is true (the scaffold default). A
  // genuinely wiring-complete repo therefore configures owners so the generator
  // materializes CODEOWNERS — this probe scaffolds that complete state.
  github: { default_owners: ['@probe/owners'] },
};

function scaffold() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbaseline-gate-'));
  const target = path.join(workDir, 'project');
  const profilePath = path.join(workDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(BASE_PROFILE));
  applyScaffold({ profile: profilePath, pluginSource: path.join(ROOT, '.claude'), target, scaffoldProfile: 'core' });
  return { workDir, target };
}

test('checkSecureBaselineWiring passes in-process on a correctly-scaffolded repo', () => {
  const { workDir, target } = scaffold();
  try {
    assert.doesNotThrow(() => strict.checkSecureBaselineWiring({ projectDir: target }));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('checkSecureBaselineWiring BLOCKs (exit 1) when security.yml is deleted', () => {
  const { workDir, target } = scaffold();
  try {
    fs.rmSync(path.join(target, '.github', 'workflows', 'security.yml'), { force: true });
    const child = `require(${JSON.stringify(path.join(ROOT, '.claude/hooks/lib/gates-strict.js'))})` +
      `.checkSecureBaselineWiring({ projectDir: ${JSON.stringify(target)} });`;
    const res = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1, 'a missing security.yml must block');
    assert.match(`${res.stdout}${res.stderr}`, /secure-baseline-wiring/);
    assert.match(`${res.stdout}${res.stderr}`, /security\.yml is absent/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

// Increment 3, C4: environments are configured by default (production), so a
// scaffolded repo with its deploy.yml deleted must block on the deploy-wiring rule.
test('checkSecureBaselineWiring BLOCKs (exit 1) when the configured environment has no deploy.yml', () => {
  const { workDir, target } = scaffold();
  try {
    fs.rmSync(path.join(target, '.github', 'workflows', 'deploy.yml'), { force: true });
    const child = `require(${JSON.stringify(path.join(ROOT, '.claude/hooks/lib/gates-strict.js'))})` +
      `.checkSecureBaselineWiring({ projectDir: ${JSON.stringify(target)} });`;
    const res = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1, 'a missing deploy.yml must block when environments are configured');
    assert.match(`${res.stdout}${res.stderr}`, /deploy\.yml is absent/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
