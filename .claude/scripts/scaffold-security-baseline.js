'use strict';

// Scaffold-time materialization of GitHub-workflow artifacts, split out of
// scaffold-apply.js (which is at the pre-write-gate length limit). Covers the
// Increment 1 secure-repo baseline (security.yml + .gitleaks.toml + the
// quality.sast_engine default) plus the pre-existing opt-in drift workflow.

const fs = require('fs');
const path = require('path');
const { renderSecurityWorkflow } = require('../hooks/lib/security-baseline');

function requireTemplate(src, rel) {
  const p = path.join(src, rel);
  if (!fs.existsSync(p)) throw new Error(`missing required template: ${p}`);
  return p;
}

// quality.sast_engine seam: default semgrep, honour an explicit veracode choice.
function applySastEngineDefault(manifest, profile) {
  if (manifest && manifest.quality && !manifest.quality.sast_engine) {
    manifest.quality.sast_engine =
      (profile && profile.quality && profile.quality.sast_engine === 'veracode') ? 'veracode' : 'semgrep';
  }
}

function readSastEngine(target) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    return (m && m.quality && m.quality.sast_engine) || 'semgrep';
  } catch (_) { return 'semgrep'; }
}

// Every scaffolded repo inherits real gitleaks + SAST as blocking CI jobs: render
// security.yml for the manifest's engine into .github/workflows/, and drop the
// .gitleaks.toml allowlist at the repo root. Returns the workflow path.
function materializeSecurityBaseline(target, src) {
  const template = fs.readFileSync(requireTemplate(src, 'templates/github-workflows/security.yml'), 'utf8');
  const workflow = renderSecurityWorkflow(readSastEngine(target), template);
  const to = path.join(target, '.github', 'workflows', 'security.yml');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, workflow.endsWith('\n') ? workflow : `${workflow}\n`);
  fs.copyFileSync(requireTemplate(src, 'templates/gitleaks.toml'), path.join(target, '.gitleaks.toml'));
  return to;
}

function driftWorkflowEnabled(profile, opts = {}) {
  return opts.driftWorkflow === true || (profile && profile.quality && profile.quality.drift && profile.quality.drift.workflow === true);
}

function copyDriftWorkflow(target, src) {
  const from = requireTemplate(src, 'templates/github-workflows/harness-drift.yml');
  const to = path.join(target, '.github', 'workflows', 'harness-drift.yml');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return to;
}

module.exports = {
  applySastEngineDefault,
  materializeSecurityBaseline,
  driftWorkflowEnabled,
  copyDriftWorkflow,
};
