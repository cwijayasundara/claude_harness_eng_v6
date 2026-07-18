'use strict';

// C4 round-trip: render the REAL security.yml template (both sast_engine values)
// and prove both jobs are present and blocking through the REAL wiring validator
// — no hand-built fixture (repo real-artifact rule). Plus a real scaffold-copy
// round-trip proving a scaffolded target inherits the guards.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { renderSecurityWorkflow, wiringViolations, parseWorkflowJobs } =
  require('../.claude/hooks/lib/security-baseline.js');
const { applyScaffold } = require('../.claude/scripts/scaffold-apply');

const TEMPLATE = fs.readFileSync(
  path.join(ROOT, '.claude', 'templates', 'github-workflows', 'security.yml'), 'utf8',
);

for (const engine of ['semgrep', 'veracode']) {
  test(`real security.yml renders two blocking jobs for sast_engine=${engine}`, () => {
    const yml = renderSecurityWorkflow(engine, TEMPLATE);
    const jobs = parseWorkflowJobs(yml);
    assert.ok(jobs.gitleaks, 'gitleaks job present');
    assert.ok(jobs.sast, 'sast job present');
    assert.strictEqual(jobs.gitleaks.continueOnError, false, 'gitleaks is blocking');
    assert.strictEqual(jobs.sast.continueOnError, false, 'sast is blocking');
    // The REAL validator (C3) must pass on the rendered artifact.
    assert.deepStrictEqual(
      wiringViolations({ workflowText: yml, gitleaksTomlExists: true, sastEngine: engine }),
      [],
    );
    // No leftover markers, and the non-selected engine's job is gone.
    assert.ok(!/>>>|<<</.test(yml), 'marker lines are stripped');
  });
}

test('semgrep render carries `semgrep ci` and no veracode content', () => {
  const yml = renderSecurityWorkflow('semgrep', TEMPLATE);
  assert.match(yml, /semgrep ci --error/);
  assert.ok(!/VERACODE/.test(yml), 'veracode block dropped');
});

test('veracode render carries the guarded Veracode step and no semgrep content', () => {
  const yml = renderSecurityWorkflow('veracode', TEMPLATE);
  assert.match(yml, /VERACODE_API_ID/);
  assert.ok(!/semgrep ci/.test(yml), 'semgrep block dropped');
});

const BASE_PROFILE = {
  name: 'secbaseline-probe',
  description: 'Probe for the secure-repo baseline scaffold artifacts.',
  stack: { backend: null, frontend: null, database: null },
  projectType: 'D',
  verificationMode: 'C',
  modelTier: 'balanced',
  tracker: 'A',
  frameworkPacks: [],
  lsp: [],
};

function scaffoldInto(scaffoldProfile) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbaseline-'));
  const target = path.join(workDir, 'project');
  const profilePath = path.join(workDir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(BASE_PROFILE));
  applyScaffold({ profile: profilePath, pluginSource: path.join(ROOT, '.claude'), target, scaffoldProfile });
  return { workDir, target };
}

for (const profile of ['core', 'full']) {
  test(`scaffold (${profile}) materializes security.yml, .gitleaks.toml, and quality.sast_engine`, () => {
    const { workDir, target } = scaffoldInto(profile);
    try {
      const wf = path.join(target, '.github', 'workflows', 'security.yml');
      assert.ok(fs.existsSync(wf), 'security.yml materialized into .github/workflows/');
      const jobs = parseWorkflowJobs(fs.readFileSync(wf, 'utf8'));
      assert.ok(jobs.gitleaks && jobs.sast, 'both jobs present in the scaffolded workflow');

      assert.ok(fs.existsSync(path.join(target, '.gitleaks.toml')), '.gitleaks.toml at repo root');

      const manifest = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
      assert.strictEqual(manifest.quality.sast_engine, 'semgrep', 'default sast_engine written');

      // The scaffolded repo passes its own wiring invariant.
      assert.deepStrictEqual(
        wiringViolations({
          workflowText: fs.readFileSync(wf, 'utf8'),
          gitleaksTomlExists: true,
          sastEngine: manifest.quality.sast_engine,
        }),
        [],
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
}
