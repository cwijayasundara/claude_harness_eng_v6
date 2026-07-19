'use strict';

// Scaffold-time materialization of GitHub-workflow artifacts, split out of
// scaffold-apply.js (which is at the pre-write-gate length limit). Covers the
// Increment 1 secure-repo baseline (security.yml + .gitleaks.toml + the
// quality.sast_engine default) plus the pre-existing opt-in drift workflow.

const fs = require('fs');
const path = require('path');
const { renderSecurityWorkflow } = require('../hooks/lib/security-baseline');
const { writeCodeowners } = require('./generate-codeowners');

// Increment 2 (C1): the branch-protection provisioner + CODEOWNERS generator read
// this block. Scaffold writes it with empty org/default_owners (placeholders, no
// client literals); a profile may override any field.
const GITHUB_DEFAULTS = {
  org: '',
  default_branch: 'main',
  required_checks: ['gitleaks', 'sast'],
  required_approvals: 1,
  require_code_owner_review: true,
  enforce_admins: true,
  ruleset_scope: 'org',
  ruleset_name: 'harness-baseline-protection',
  target_repos: '~ALL',
  default_owners: [],
};

// Ensure manifest.github carries the full defaults. Deep-merge so a PARTIAL block
// (e.g. a profile that supplies only {org}) still inherits every strong security
// field — required_checks, required_approvals, require_code_owner_review, … —
// rather than silently under-provisioning them. Precedence, low→high:
// GITHUB_DEFAULTS < profile.github < any field already on manifest.github.
function applyGithubDefault(manifest, profile) {
  if (!manifest) return;
  manifest.github = {
    ...GITHUB_DEFAULTS,
    ...((profile && profile.github) || {}),
    ...(manifest.github || {}),
  };
}

// Render .github/CODEOWNERS from the target's github.default_owners (C3). Skips
// (no file) when owners are empty. When code-owner review is required but no
// owners are configured, surface the contradiction LOUDLY at scaffold time — a
// strict-tier repo would otherwise self-block its first commit on the wiring gate.
function materializeCodeowners(target) {
  let github = {};
  try {
    const m = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    github = (m && m.github) || {};
  } catch (_) { github = {}; }
  const noOwners = !Array.isArray(github.default_owners) || github.default_owners.length === 0;
  if (github.require_code_owner_review === true && noOwners) {
    process.stderr.write(
      'ACTION REQUIRED: project-manifest.json github.require_code_owner_review is true but ' +
      'github.default_owners is empty. Set default_owners before enabling strict tier, or the ' +
      'CODEOWNERS review requirement will block commits.\n');
  }
  return writeCodeowners(target, github);
}

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
  applyGithubDefault,
  materializeSecurityBaseline,
  materializeCodeowners,
  driftWorkflowEnabled,
  copyDriftWorkflow,
};
