#!/usr/bin/env node

'use strict';

// Agent-readiness report (gap G21). A REPORT-ONLY meta-tool, same shape as
// harness-coverage.js (G11): aggregates state this harness's OWN sensors
// already produce into 8 pillars adapted from Factory.ai's "agent readiness"
// framing, and reports a maturity signal per pillar using
// harness-manifest.json#model.statuses' exact vocabulary (active/partial/
// planned). It is NOT registered in harness-manifest.json's guides[]/
// sensors[] arrays — like harness-coverage.js, it inspects/reports on
// existing sensor output and codebase state rather than governing code
// directly (see HARNESS.md's standalone "Agent readiness (G21)" section).
// Invents no new measurements: pillar scoring lives in
// hooks/lib/agent-readiness.js and hooks/lib/agent-readiness-project.js,
// which this script only orchestrates and renders. Exit 0 always.

const fs = require('fs');
const path = require('path');
const { styleValidationPillar, architectureFitnessPillar, testingPillar } = require('../hooks/lib/agent-readiness');
const {
  modularityFreshnessPillar, documentationPillar, observabilityPillar,
  securityGovernancePillar, devEnvironmentPillar,
} = require('../hooks/lib/agent-readiness-project');

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function buildPillars(root) {
  return [
    styleValidationPillar(root),
    architectureFitnessPillar(root),
    testingPillar(root),
    modularityFreshnessPillar(root),
    documentationPillar(root),
    observabilityPillar(root),
    securityGovernancePillar(root),
    devEnvironmentPillar(root),
  ];
}

function summarize(pillars) {
  const out = { active: 0, partial: 0, planned: 0 };
  for (const p of pillars) out[p.status] += 1;
  return out;
}

function statusIcon(status) {
  if (status === 'active') return '✅';
  if (status === 'partial') return '⚠️';
  return '⛔';
}

function renderMd(pillars, summary, generatedAt) {
  const lines = [
    '# Agent readiness report', '', `Generated: ${generatedAt}`, '',
    `Active: ${summary.active}/8 · Partial: ${summary.partial}/8 · Planned: ${summary.planned}/8`,
    '', '| Pillar | Status | Detail |', '|---|---|---|',
  ];
  for (const p of pillars) lines.push(`| ${p.label} | ${statusIcon(p.status)} ${p.status} | ${p.detail} |`);
  const needsWork = pillars.filter((p) => p.remediation);
  lines.push('', '## Remediation');
  if (!needsWork.length) lines.push('', 'All pillars are active — nothing to remediate.');
  for (const p of needsWork) lines.push(`- **${p.label}**: ${p.remediation}`);
  return lines.join('\n') + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const generatedAt = new Date().toISOString();
  const pillars = buildPillars(root);
  const summary = summarize(pillars);
  const report = { generatedAt, summary, pillars };

  const outDir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'agent-readiness.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'agent-readiness.md'), renderMd(pillars, summary, generatedAt));

  process.stdout.write(
    `agent-readiness: active ${summary.active}/8, partial ${summary.partial}/8, planned ${summary.planned}/8. ` +
    `Report: specs/reviews/agent-readiness.md\n`
  );
  process.exit(0);
}

module.exports = { buildPillars, summarize, renderMd };

if (require.main === module) main();
