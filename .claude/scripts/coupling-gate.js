#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/coupling-gate.js
// Unstable-hub ratchet (gap G18): reads specs/brownfield/code-graph.json,
// computes the unstable-hub set (fan_in >= 5, instability >= 0.8 — the same
// thresholds drift.js's coupling-report and drift-architecture sensor already
// use), and compares it to .claude/state/coupling-baseline.txt. The COUNT may
// only stay equal or drop — a change that RAISES the unstable-hub count exits
// 1 (BLOCK), naming the specific new hub(s) with fan-in/instability numbers
// and concrete remediation. The baseline ratchets down when hubs are fixed.
// Count-based, not set-based (see docs/sensor-arbitration.md's G18 section):
// a same-commit swap at an unchanged count is not caught. No graph → skip
// loudly (exit 0); the signal is only as fresh as the last /code-map or
// graph-refresh. Run in /gate and /auto Gate 4, or `npm run
// coupling-gate`. Mirrors cycle-gate.js's shape exactly.

const fs = require('fs');
const path = require('path');
const { unstableHubKeys, gateDecision } = require('../hooks/lib/coupling-gate');

const REPO = process.cwd();
const GRAPH = path.join(REPO, 'specs', 'brownfield', 'code-graph.json');
const BASELINE = path.join(REPO, '.claude', 'state', 'coupling-baseline.txt');

// The baseline file stores the unstable-hub id set (one per line), not just a
// count — unlike cycle-baseline.txt, this gate needs to know WHICH ids were
// already unstable last run so a BLOCK can name the specific new hub(s).
function readBaseline() {
  try {
    const raw = fs.readFileSync(BASELINE, 'utf8');
    return raw.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (_) {
    return undefined;
  }
}

function writeBaseline(ids) {
  try {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, ids.length ? `${ids.join('\n')}\n` : '');
  } catch (_) { /* best effort */ }
}

function hubDetail(hubs, id) {
  const h = hubs.find((x) => x.id === id);
  if (!h) return `  - ${id}`;
  const instability = Number(h.instability).toFixed(2);
  return `  - ${id} (fan_in=${h.fan_in}, instability=${instability})`;
}

function remediation() {
  return (
    'Fix: extract a narrower interface for each hub above so its dependents stop coupling to ' +
    "the file's full surface — split responsibilities, or introduce a facade exposing only the " +
    'members callers actually use. Either move lowers fan-in without touching every caller at ' +
    'once. Then retry.\n'
  );
}

function blockMessage(d, keys, prevIds, hubs) {
  const prevSet = new Set(prevIds || []);
  const newIds = keys.filter((id) => !prevSet.has(id));
  return (
    `BLOCKED: unstable-hub count increased ${d.baseline} -> ${d.count} (the ratchet only goes down):\n` +
    newIds.map((id) => hubDetail(hubs, id)).join('\n') +
    '\n' + remediation()
  );
}

function main() {
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  } catch (_) {
    process.stdout.write(
      'WARNING: coupling gate SKIPPED — no code-graph (run /code-map or /brownfield first). ' +
      'Unstable hubs not verified.\n'
    );
    process.exit(0);
  }

  const keys = unstableHubKeys(graph);
  const prevIds = readBaseline();
  const d = gateDecision(keys, prevIds ? prevIds.length : undefined);

  if (d.blocked) {
    const hubs = ((graph.metrics) || {}).hubs || [];
    process.stderr.write(blockMessage(d, keys, prevIds, hubs));
    process.exit(1);
  }

  writeBaseline(keys);
  process.stdout.write(
    `coupling-gate OK: ${d.count} unstable hubs (baseline ${d.newBaseline}${d.baselineRun ? ', established' : ''}).\n`
  );
  process.exit(0);
}

if (require.main === module) main();
