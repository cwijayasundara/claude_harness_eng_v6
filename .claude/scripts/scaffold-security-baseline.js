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
  // Increment 3 (C1): the deployment-approval Environments provisioner + deploy.yml
  // skeleton read this. reviewers default to [] (client-specific ids, no literals);
  // an empty array is loud non-compliant at --verify. Empty/absent environments ⇒
  // no environment provisioning and no deploy-wiring requirement.
  environments: [
    { name: 'production', reviewers: [], wait_timer: 0, protected_branches: true },
  ],
};

// Ensure manifest.github carries the full defaults. Deep-merge so a PARTIAL block
// (e.g. a profile that supplies only {org}) still inherits every strong security
// field — required_checks, required_approvals, require_code_owner_review,
// environments, … — rather than silently under-provisioning them. A per-key
// spread is the deep-merge that matters here: an absent key on the partial block
// keeps the default (so {org} alone still inherits the production environments
// gate). Precedence, low→high: GITHUB_DEFAULTS < profile.github < any field
// already on manifest.github.
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

// Increment 3 (C3): read the first configured environment's name for the deploy
// skeleton's `environment:` gate. Empty/absent environments ⇒ null (no workflow).
function firstEnvironmentName(target) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    const envs = m && m.github && m.github.environments;
    return (Array.isArray(envs) && envs.length && envs[0].name) ? envs[0].name : null;
  } catch (_) { return null; }
}

// Render the environment-gated deploy.yml skeleton into the target, stamping the
// `environment:` gate with the first configured environment's name (no client
// literals — the name comes from config). Returns the workflow path, or null when
// no environments are configured (not every project deploys via GitHub Actions).
const ENV_NAME = /^[A-Za-z0-9._-]+$/;

function materializeDeployWorkflow(target, src) {
  const envName = firstEnvironmentName(target);
  if (!envName) return null;
  // The name is stamped into the workflow — reject anything but a safe segment,
  // and use a replacement FUNCTION so a `$` in the value can never be read as a
  // replacement special ($&, $1) and corrupt the YAML.
  if (!ENV_NAME.test(envName)) {
    throw new Error(`scaffold: invalid environment name "${envName}" (chars [A-Za-z0-9._-])`);
  }
  const template = fs.readFileSync(requireTemplate(src, 'templates/github-workflows/deploy.yml'), 'utf8');
  const workflow = template.replace(/^(\s*environment:\s*).*$/m, (_m, p1) => `${p1}${envName}`);
  const to = path.join(target, '.github', 'workflows', 'deploy.yml');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, workflow.endsWith('\n') ? workflow : `${workflow}\n`);
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
  materializeDeployWorkflow,
  driftWorkflowEnabled,
  copyDriftWorkflow,
};
