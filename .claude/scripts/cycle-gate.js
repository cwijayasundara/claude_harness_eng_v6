#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/cycle-gate.js
// Cycle-fail ratchet (gap G8): reads specs/brownfield/code-graph.json, counts
// import cycles, and compares to .claude/state/cycle-baseline.txt. The count may
// only stay equal or drop — a change that ADDS a cycle exits 1 (BLOCK). The
// baseline ratchets down when cycles are removed. No graph → skip loudly (exit
// 0); the count is only as fresh as the last /code-map or graph-refresh.
// Run in /gate and /auto Gate 4, or `npm run cycles`.

const fs = require('fs');
const path = require('path');
const { cycleKeys, gateDecision } = require('../hooks/lib/cycle-gate');

const REPO = process.cwd();
const GRAPH = path.join(REPO, 'specs', 'brownfield', 'code-graph.json');
const BASELINE = path.join(REPO, '.claude', 'state', 'cycle-baseline.txt');

function readBaseline() {
  try {
    const n = parseFloat(fs.readFileSync(BASELINE, 'utf8').trim());
    return Number.isFinite(n) ? n : undefined;
  } catch (_) {
    return undefined;
  }
}

function writeBaseline(n) {
  try {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, `${n}\n`);
  } catch (_) { /* best effort */ }
}

function main() {
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  } catch (_) {
    process.stdout.write('WARNING: cycle gate SKIPPED — no code-graph (run /code-map or /brownfield first). Cycles not verified.\n');
    process.exit(0);
  }
  const keys = cycleKeys(graph);
  const d = gateDecision(keys, readBaseline());
  if (d.blocked) {
    process.stderr.write(
      `BLOCKED: import cycles increased ${d.baseline} -> ${d.count} (the ratchet only goes down):\n` +
      keys.map((k) => `  - ${k}`).join('\n') +
      '\nFix: break the new cycle (extract the shared piece, or invert one dependency), then retry.\n'
    );
    process.exit(1);
  }
  writeBaseline(d.newBaseline);
  process.stdout.write(`cycle-gate OK: ${d.count} cycles (baseline ${d.newBaseline}${d.baselineRun ? ', established' : ''}).\n`);
  process.exit(0);
}

if (require.main === module) main();
