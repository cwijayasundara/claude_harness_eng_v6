#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/sensor-value-report.js [--min-runs N] [--json]
// Makes the biting-meta value meter CONSUMABLE (harness-simplification P0 rec #2).
// recordOutcome already fills .claude/state/sensor-outcomes.jsonl at every
// commit-gate run (gate-registry.js), but nothing turned that into a cut list.
// This ranks each catalogued commit gate by how often it RAN and how often it
// BLOCKED, and names the ones that have never blocked (candidate shelfware) so
// /retro can propose retiring them — the counter-force to accretion needs a
// nomination surface, not just a budget ceiling.
// Report-only: never blocks, never exits non-zero on findings.

const path = require('path');
const { readOutcomes } = require('../hooks/lib/sensor-outcomes');
const { GATE_CATALOG } = require('../hooks/lib/gate-registry');

const REPO = path.resolve(__dirname, '..', '..');

function tally(outcomes) {
  const stats = new Map();
  for (const o of outcomes) {
    const s = stats.get(o.sensor) || { ran: 0, blocked: 0 };
    if (o.ran) s.ran += 1;
    if (o.blocked) s.blocked += 1;
    stats.set(o.sensor, s);
  }
  return stats;
}

function classify(stats) {
  const rows = GATE_CATALOG.map((g) => {
    const s = stats.get(g.id) || { ran: 0, blocked: 0 };
    return { id: g.id, ran: s.ran, blocked: s.blocked };
  });
  return {
    rows,
    neverRan: rows.filter((r) => r.ran === 0).map((r) => r.id),
    neverBlocked: rows.filter((r) => r.ran > 0 && r.blocked === 0).map((r) => r.id),
  };
}

function render(outcomes, minRuns) {
  const totalRuns = outcomes.length;
  const { rows, neverRan, neverBlocked } = classify(tally(outcomes));
  if (totalRuns < minRuns) {
    return `sensor-value-report: INSUFFICIENT DATA — ${totalRuns} recorded outcome(s), need >= ${minRuns}.\n` +
      'The commit gate must run over real history (git pre-commit -> runPreCommit) before\n' +
      'idle-sensor nominations are trustworthy. No cut list yet.\n';
  }
  const lines = [`sensor-value-report: ${totalRuns} recorded outcomes across ${GATE_CATALOG.length} commit gates.`];
  lines.push('', 'NEVER FIRED (never ran — check wiring or retire): ' + (neverRan.join(', ') || 'none'));
  lines.push('NEVER BLOCKED (ran but never caught anything — candidate shelfware for /retro): ' + (neverBlocked.join(', ') || 'none'));
  lines.push('', ...rows.map((r) => `  ${r.id}: ran=${r.ran} blocked=${r.blocked}`));
  return lines.join('\n') + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const minIdx = argv.indexOf('--min-runs');
  const minRuns = minIdx >= 0 ? Number(argv[minIdx + 1]) || 20 : 20;
  const outcomes = readOutcomes(REPO);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(classify(tally(outcomes)), null, 2) + '\n');
    return;
  }
  process.stdout.write(render(outcomes, minRuns));
}

if (require.main === module) main();

module.exports = { tally, classify, render };
