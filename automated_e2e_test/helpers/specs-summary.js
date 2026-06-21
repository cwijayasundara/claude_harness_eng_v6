'use strict';

// Deterministic summary of the architect's planning output under specs/. Used by
// the plan-only smoke to print "what got generated" so a human can eyeball the
// clusters and dependency graph without a tracker or a live build. Pure file
// reads — no LLM, no network.

const fs = require('fs');
const path = require('path');

// Expected planning artifacts, keyed by the short name the summary reports.
const EXPECTED = {
  brd: 'specs/brd/brd.md',
  brdRequirements: 'specs/brd/brd-requirements.json',
  dependencyGraph: 'specs/stories/dependency-graph.md',
  design: 'specs/design/component-map.md',
  apiContracts: 'specs/design/api-contracts.md',
  testPlan: 'specs/test_artefacts/test-plan.md',
};

function readOr(projectDir, rel, fallback) {
  try { return fs.readFileSync(path.join(projectDir, rel), 'utf8'); }
  catch (_) { return fallback; }
}

function countStories(projectDir) {
  try {
    return fs.readdirSync(path.join(projectDir, 'specs', 'stories'))
      .filter((f) => /^E\d+-S\d+\.md$/.test(f)).length;
  } catch (_) { return 0; }
}

function summarizeSpecs(projectDir) {
  const present = {};
  const missing = [];
  for (const [key, rel] of Object.entries(EXPECTED)) {
    const ok = fs.existsSync(path.join(projectDir, rel));
    present[key] = ok;
    if (!ok) missing.push(rel);
  }

  const graph = readOr(projectDir, EXPECTED.dependencyGraph, '');
  const clusters = new Set((graph.match(/\bGroup\s+([A-Z])\b/g) || [])).size;
  const edges = (graph.match(/-->/g) || []).length;

  return { present, missing, clusters, edges, stories: countStories(projectDir) };
}

function formatSummary(projectDir, s = summarizeSpecs(projectDir)) {
  const lines = [
    'specs/ inventory:',
    ...Object.entries(s.present).map(([k, ok]) => `  [${ok ? 'x' : ' '}] ${k}`),
    `clusters (dependency groups): ${s.clusters}`,
    `dependency edges:             ${s.edges}`,
    `stories (E*-S* files):        ${s.stories}`,
    s.missing.length ? `MISSING: ${s.missing.join(', ')}` : 'all expected artifacts present',
  ];
  return lines.join('\n');
}

module.exports = { summarizeSpecs, formatSummary, EXPECTED };
