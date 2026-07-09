'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  styleValidationPillar, architectureFitnessPillar, testingPillar,
} = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'agent-readiness.js'));
const {
  modularityFreshnessPillar, documentationPillar, observabilityPillar,
  securityGovernancePillar, devEnvironmentPillar,
} = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'agent-readiness-project.js'));

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-readiness-'));
}

function writeJson(root, rel, obj) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

function writeFile(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const allTrue = () => true;
const allFalse = () => false;

// --- Style & Validation ----------------------------------------------------

test('style-validation: no stack detected -> planned', () => {
  const p = styleValidationPillar(tmpRoot());
  assert.strictEqual(p.status, 'planned');
  assert.ok(p.remediation);
});

test('style-validation: package.json present, no eslint config -> planned', () => {
  const root = tmpRoot();
  writeJson(root, 'package.json', { name: 'x' });
  const p = styleValidationPillar(root, { runCheck: allTrue });
  assert.strictEqual(p.status, 'planned');
});

test('style-validation: config present but tool unprovisioned -> partial', () => {
  const root = tmpRoot();
  writeJson(root, 'package.json', { name: 'x' });
  writeFile(root, '.eslintrc.json', '{}');
  const p = styleValidationPillar(root, { runCheck: allFalse });
  assert.strictEqual(p.status, 'partial');
});

test('style-validation: configured and provisioned -> active', () => {
  const root = tmpRoot();
  writeJson(root, 'package.json', { name: 'x' });
  writeFile(root, '.eslintrc.json', '{}');
  const p = styleValidationPillar(root, { runCheck: allTrue });
  assert.strictEqual(p.status, 'active');
  assert.strictEqual(p.remediation, null);
});

// --- Architecture Fitness ---------------------------------------------------

test('architecture-fitness: no baselines -> planned', () => {
  assert.strictEqual(architectureFitnessPillar(tmpRoot()).status, 'planned');
});

test('architecture-fitness: only one baseline -> partial', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/cycle-baseline.txt', '0\n');
  assert.strictEqual(architectureFitnessPillar(root).status, 'partial');
});

test('architecture-fitness: both baselines established -> active regardless of count', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/cycle-baseline.txt', '3\n');
  writeFile(root, '.claude/state/coupling-baseline.txt', 'a.js\nb.js\n');
  const p = architectureFitnessPillar(root);
  assert.strictEqual(p.status, 'active');
  assert.match(p.detail, /3 cycle/);
  assert.match(p.detail, /2 unstable hub/);
});

// --- Testing -----------------------------------------------------------------

test('testing: nothing present -> planned', () => {
  assert.strictEqual(testingPillar(tmpRoot()).status, 'planned');
});

test('testing: all three signals present, no AT artifacts -> active with informational note', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/coverage-baseline.txt', '85\n');
  writeFile(root, '.claude/scripts/mutation-gate.js', '// stub');
  writeFile(root, '.claude/scripts/regression-gate.js', '// stub');
  writeFile(root, '.claude/scripts/local-regression-gate.js', '// stub');
  writeJson(root, 'package.json', {
    scripts: { mutation: 'x', 'regression-gate': 'x', 'local-regression-gate': 'x' },
  });
  const p = testingPillar(root);
  assert.strictEqual(p.status, 'active');
  assert.match(p.detail, /G20 not yet adopted/);
});

test('testing: AT artifacts present are reported in detail', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/coverage-baseline.txt', '85\n');
  writeFile(root, '.claude/scripts/mutation-gate.js', '// stub');
  writeFile(root, '.claude/scripts/regression-gate.js', '// stub');
  writeFile(root, '.claude/scripts/local-regression-gate.js', '// stub');
  writeJson(root, 'package.json', {
    scripts: { mutation: 'x', 'regression-gate': 'x', 'local-regression-gate': 'x' },
  });
  writeFile(root, 'specs/test_artefacts/acceptance/E1-S1.md', '# AT');
  const p = testingPillar(root);
  assert.match(p.detail, /1 acceptance-test artifact\(s\) found \(G20 adopted\)/);
});

test('testing: only mutation-gate script without npm script -> not counted, partial', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/coverage-baseline.txt', '85\n');
  writeFile(root, '.claude/scripts/mutation-gate.js', '// stub');
  const p = testingPillar(root);
  assert.strictEqual(p.status, 'partial');
});

// --- Code Quality / Modularity freshness ------------------------------------

function graphWithHubs(hubs) {
  return { metrics: { hubs } };
}

test('modularity-freshness: no code-graph -> planned', () => {
  assert.strictEqual(modularityFreshnessPillar(tmpRoot()).status, 'planned');
});

test('modularity-freshness: no marker, no unstable hubs -> partial', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json', graphWithHubs([]));
  assert.strictEqual(modularityFreshnessPillar(root).status, 'partial');
});

test('modularity-freshness: no marker, unstable hubs exist -> planned', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json',
    graphWithHubs([{ id: 'src/god.js', fan_in: 9, fan_out: 1, instability: 0.9 }]));
  assert.strictEqual(modularityFreshnessPillar(root).status, 'planned');
});

test('modularity-freshness: marker covers all current unstable hubs -> active', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json',
    graphWithHubs([{ id: 'src/god.js', fan_in: 9, fan_out: 1, instability: 0.9 }]));
  writeJson(root, '.claude/state/modularity-review-marker.json',
    { timestamp: 'x', unstableHubIds: ['src/god.js'] });
  assert.strictEqual(modularityFreshnessPillar(root).status, 'active');
});

test('modularity-freshness: a hub went unstable since the marker -> partial, names the hub', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json',
    graphWithHubs([{ id: 'src/new-hub.js', fan_in: 9, fan_out: 1, instability: 0.9 }]));
  writeJson(root, '.claude/state/modularity-review-marker.json', { timestamp: 'x', unstableHubIds: [] });
  const p = modularityFreshnessPillar(root);
  assert.strictEqual(p.status, 'partial');
  assert.match(p.detail, /src\/new-hub\.js/);
});

// --- Documentation / Navigation ---------------------------------------------

test('documentation-navigation: no code-graph -> planned', () => {
  assert.strictEqual(documentationPillar(tmpRoot()).status, 'planned');
});

test('documentation-navigation: fresh graph, both derived files present and no stale banner -> active', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json', {});
  writeFile(root, 'specs/brownfield/dependency-graph.md', '# deps');
  writeFile(root, 'specs/brownfield/coupling-report.md', '# coupling');
  assert.strictEqual(documentationPillar(root).status, 'active');
});

test('documentation-navigation: code-graph exists but derived nav was never generated -> partial, not active', () => {
  // Regression for the G21 review's CR-001: the old isStale() caught the
  // missing-file read error and returned false, so "absent" silently read
  // as "not stale" = healthy. A code-graph with no derived nav at all must
  // NOT be reported as ready.
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json', {});
  const p = documentationPillar(root);
  assert.strictEqual(p.status, 'partial');
  assert.match(p.detail, /has not been generated yet/);
});

test('documentation-navigation: one derived file present, the other missing -> partial', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json', {});
  writeFile(root, 'specs/brownfield/dependency-graph.md', '# deps');
  assert.strictEqual(documentationPillar(root).status, 'partial');
});

test('documentation-navigation: STALE-stamped derived artifact -> partial', () => {
  const root = tmpRoot();
  writeJson(root, 'specs/brownfield/code-graph.json', {});
  writeFile(root, 'specs/brownfield/dependency-graph.md', '> STALE since 2026-01-01T00:00:00.000Z — code-graph.json was patched\n\n# deps');
  assert.strictEqual(documentationPillar(root).status, 'partial');
});

// --- Observability -----------------------------------------------------------

test('observability: no project-manifest -> planned', () => {
  assert.strictEqual(observabilityPillar(tmpRoot()).status, 'planned');
});

test('observability: manifest with no observability block -> planned', () => {
  const root = tmpRoot();
  writeJson(root, 'project-manifest.json', {});
  assert.strictEqual(observabilityPillar(root).status, 'planned');
});

test('observability: explicitly disabled -> partial', () => {
  const root = tmpRoot();
  writeJson(root, 'project-manifest.json', { observability: { enabled: false } });
  assert.strictEqual(observabilityPillar(root).status, 'partial');
});

test('observability: enabled -> active', () => {
  const root = tmpRoot();
  writeJson(root, 'project-manifest.json', { observability: { enabled: true, metrics_path: '/metrics' } });
  const p = observabilityPillar(root);
  assert.strictEqual(p.status, 'active');
  assert.match(p.detail, /\/metrics/);
});

// --- Security & Governance ----------------------------------------------------

test('security-governance: no security-scan.js -> planned', () => {
  assert.strictEqual(securityGovernancePillar(tmpRoot()).status, 'planned');
});

test('security-governance: script present, all tools provisioned -> active', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/scripts/security-scan.js', '// stub');
  const p = securityGovernancePillar(root, { runCheck: allTrue });
  assert.strictEqual(p.status, 'active');
});

test('security-governance: script present, some tools unprovisioned -> partial', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/scripts/security-scan.js', '// stub');
  let calls = 0;
  const p = securityGovernancePillar(root, { runCheck: () => { calls += 1; return calls === 1; } });
  assert.strictEqual(p.status, 'partial');
});

// --- Dev Environment -----------------------------------------------------------

test('dev-environment: no project-manifest -> planned', () => {
  assert.strictEqual(devEnvironmentPillar(tmpRoot()).status, 'planned');
});

test('dev-environment: docker mode without init.sh -> partial', () => {
  const root = tmpRoot();
  writeJson(root, 'project-manifest.json', { verification: { mode: 'docker' } });
  assert.strictEqual(devEnvironmentPillar(root).status, 'partial');
});

test('dev-environment: docker mode with init.sh -> active', () => {
  const root = tmpRoot();
  writeJson(root, 'project-manifest.json', { verification: { mode: 'docker' } });
  writeFile(root, 'init.sh', '#!/bin/sh\n');
  assert.strictEqual(devEnvironmentPillar(root).status, 'active');
});

test('dev-environment: local mode without init.sh -> active (not required)', () => {
  const root = tmpRoot();
  writeJson(root, 'project-manifest.json', { verification: { mode: 'local' } });
  assert.strictEqual(devEnvironmentPillar(root).status, 'active');
});
