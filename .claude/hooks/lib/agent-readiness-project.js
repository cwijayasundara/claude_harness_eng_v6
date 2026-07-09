'use strict';

// Pure per-pillar scoring logic for the agent-readiness report (gap G21) —
// this file: Code Quality / Modularity Freshness (G19), Documentation /
// Navigation (living-navigation-refresh), Observability (G9), Security &
// Governance (G3), Dev Environment. The other three pillars (Style &
// Validation, Architecture Fitness, Testing) live in agent-readiness.js —
// see that file's header for the split rationale. Reuses drift.js's
// hubsForStabilityCheck (G26)/withModularityStaleness (G19) and stale-stamp.js's
// STALE_MARK rather than reimplementing either.

const fs = require('fs');
const path = require('path');
const { readJsonSafe, pillar, bool, defaultToolCheck } = require('./agent-readiness-shared');
const { hubsForStabilityCheck, withModularityStaleness } = require('./drift');
const { STALE_MARK } = require('./stale-stamp');

// --- Code Quality / Modularity freshness (G19) ----------------------------

function noGraphModularity() {
  return pillar('modularity-freshness', 'Code Quality / Modularity Freshness', 'planned',
    'No code-graph.json yet — modularity staleness cannot be computed.',
    'Run `/brownfield` (or `/code-map`) to produce a code-graph, then a modularity review to establish a baseline.');
}

function noMarkerModularity(currentHubs) {
  if (currentHubs.length === 0) {
    return pillar('modularity-freshness', 'Code Quality / Modularity Freshness', 'partial',
      'No unstable hubs currently, but no modularity review has ever been recorded.',
      'Run `/brownfield --full` or `/design --delta` once to establish the modularity-review-marker baseline.');
  }
  return pillar('modularity-freshness', 'Code Quality / Modularity Freshness', 'planned',
    `${currentHubs.length} unstable hub(s) exist and no modularity review has ever run.`,
    'Run `/brownfield --full` or `/design --delta` (Step D3.5) to review the flagged hubs.');
}

function modularityFreshnessPillar(root) {
  const graph = readJsonSafe(path.join(root, 'specs', 'brownfield', 'code-graph.json'));
  if (!graph) return noGraphModularity();
  const currentHubs = hubsForStabilityCheck(graph);
  const marker = readJsonSafe(path.join(root, '.claude', 'state', 'modularity-review-marker.json'));
  if (!marker) return noMarkerModularity(currentHubs);
  const stale = withModularityStaleness({}, marker.unstableHubIds, currentHubs).modularityStaleHubs;
  if (stale.length > 0) {
    return pillar('modularity-freshness', 'Code Quality / Modularity Freshness', 'partial',
      `${stale.length} hub(s) went unstable since the last review: ${stale.join(', ')}.`,
      'Run `/brownfield --full` or `/design --delta` (Step D3.5) to re-review the newly-stale hubs.');
  }
  return pillar('modularity-freshness', 'Code Quality / Modularity Freshness', 'active',
    'No modularity staleness — the last real review covers all currently unstable hubs.', null);
}

// --- Documentation / Navigation (living-navigation-refresh) --------------

// 'missing' is NOT the same as 'fresh': a derived-nav file that was never
// generated must not read as healthy just because there's nothing stale to
// find (the vacuous-pass class this harness repeatedly guards against —
// "can't check" is not "checked and fine").
function navFileState(root, name) {
  let content;
  try {
    content = fs.readFileSync(path.join(root, 'specs', 'brownfield', name), 'utf8');
  } catch (_) {
    return 'missing';
  }
  return content.startsWith(STALE_MARK) ? 'stale' : 'fresh';
}

function documentationPillar(root) {
  const graphPath = path.join(root, 'specs', 'brownfield', 'code-graph.json');
  if (!fs.existsSync(graphPath)) {
    return pillar('documentation-navigation', 'Documentation / Navigation', 'planned',
      'No living DeepWiki/code-graph exists yet.',
      'Run `/brownfield` (or `/code-map`) to generate the living navigation, kept fresh by graph-refresh.js.');
  }
  const states = ['dependency-graph.md', 'coupling-report.md'].map((f) => navFileState(root, f));
  if (states.includes('missing')) {
    return pillar('documentation-navigation', 'Documentation / Navigation', 'partial',
      'A code-graph exists but the derived navigation (dependency-graph.md / coupling-report.md) has not been generated yet.',
      'Run `/code-map` to generate the derived navigation from the current code-graph.');
  }
  if (states.includes('stale')) {
    return pillar('documentation-navigation', 'Documentation / Navigation', 'partial',
      'The derived navigation (dependency-graph.md / coupling-report.md) is stamped STALE.',
      'Run `/code-map` to regenerate the derived navigation from the current code-graph.');
  }
  return pillar('documentation-navigation', 'Documentation / Navigation', 'active',
    'Living code-graph exists and derived navigation is present and not stamped stale.', null);
}

// --- Observability (G9) ----------------------------------------------------

function observabilityPillar(root) {
  const manifest = readJsonSafe(path.join(root, 'project-manifest.json'));
  if (!manifest) {
    return pillar('observability', 'Observability', 'planned',
      'No project-manifest.json found.',
      'Run `/scaffold` to establish project-manifest.json#observability.');
  }
  const obs = manifest.observability;
  if (!obs) {
    return pillar('observability', 'Observability', 'planned',
      'project-manifest.json has no observability block.',
      'Re-run `/scaffold` (or add project-manifest.json#observability) to opt into the RED-metrics baseline (gap G9).');
  }
  if (!obs.enabled) {
    return pillar('observability', 'Observability', 'partial',
      'observability.enabled is false — the RED-metrics baseline is explicitly opted out.',
      'Set project-manifest.json#observability.enabled:true if this project has a backend to instrument.');
  }
  return pillar('observability', 'Observability', 'active',
    `RED-metrics baseline enabled (metrics_path: ${obs.metrics_path || '/metrics'}).`, null);
}

// --- Security & Governance (G3) -------------------------------------------

function depsToolProvisioned(root, runCheck) {
  if (fs.existsSync(path.join(root, 'package.json'))) return runCheck(['npm', 'audit', '--json'], root);
  if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt'))) {
    return runCheck(['pip-audit', '--format=json'], root);
  }
  return true; // no dependency manifest to audit — not applicable, don't penalize
}

function securityGovernancePillar(root, opts) {
  const runCheck = (opts && opts.runCheck) || defaultToolCheck;
  const scanPath = path.join(root, '.claude', 'scripts', 'security-scan.js');
  if (!fs.existsSync(scanPath)) {
    return pillar('security-governance', 'Security & Governance', 'planned',
      'No security-scan.js — computational security sensors (gap G3) are not installed.',
      'Run `/scaffold` (or copy .claude/scripts/security-scan.js) to install the security-scan tooling.');
  }
  const semgrep = runCheck(['semgrep', '--version'], root);
  const gitleaks = runCheck(['gitleaks', 'version'], root);
  const depsTool = depsToolProvisioned(root, runCheck);
  const status = [semgrep, gitleaks, depsTool].every(Boolean) ? 'active' : 'partial';
  return pillar('security-governance', 'Security & Governance', status,
    `Baseline secrets scan always active. Enhanced tools — semgrep: ${bool(semgrep)}, gitleaks: ${bool(gitleaks)}, dep-audit: ${bool(depsTool)}.`,
    'Install the missing enhanced tool(s) (semgrep, gitleaks, and/or npm/pip audit) so `/gate` can run the full computational security tier.');
}

// --- Dev Environment -------------------------------------------------------

function devEnvironmentPillar(root) {
  const manifest = readJsonSafe(path.join(root, 'project-manifest.json'));
  const initShExists = fs.existsSync(path.join(root, 'init.sh'));
  if (!manifest) {
    return pillar('dev-environment', 'Dev Environment', 'planned',
      'No project-manifest.json found.',
      'Run `/scaffold` to establish the project manifest and init.sh bootstrap script.');
  }
  const mode = (manifest.verification || {}).mode;
  if (mode === 'docker' && !initShExists) {
    return pillar('dev-environment', 'Dev Environment', 'partial',
      'verification.mode is "docker" but no init.sh bootstrap script exists.',
      'Run `/deploy` to generate init.sh, docker-compose.yml, and the Dockerfiles the docker verification mode expects.');
  }
  return pillar('dev-environment', 'Dev Environment', 'active',
    `verification.mode: ${mode || 'unset'}; init.sh: ${bool(initShExists)}.`, null);
}

module.exports = {
  modularityFreshnessPillar, documentationPillar, observabilityPillar,
  securityGovernancePillar, devEnvironmentPillar,
};
