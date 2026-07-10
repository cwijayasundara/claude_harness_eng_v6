'use strict';

// Strict-tier only: cycle + coupling ratchets at pre-commit (same logic as CLI).

const fs = require('fs');
const path = require('path');
const { failBlock, noteSkip } = require('./pre-commit-util');

// Lazy-require cycle/coupling (coupling-gate pulls drift.js → code-map scripts
// that fixtures do not copy). Only load when a strict gate actually runs.

function checkCycleDetection(ctx) {
  const { cycleKeys, gateDecision } = require('./cycle-gate');
  const { projectDir } = ctx;
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const baselinePath = path.join(projectDir, '.claude', 'state', 'cycle-baseline.txt');
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (_) {
    noteSkip('cycle-detection', 'no code-graph (run /code-map or /brownfield first)');
    return;
  }
  let baseline;
  try {
    const n = parseFloat(fs.readFileSync(baselinePath, 'utf8').trim());
    baseline = Number.isFinite(n) ? n : undefined;
  } catch (_) {
    baseline = undefined;
  }
  const keys = cycleKeys(graph);
  const d = gateDecision(keys, baseline);
  if (d.blocked) {
    failBlock({
      id: 'cycle-detection',
      title: `import cycles increased ${d.baseline} -> ${d.count} (the ratchet only goes down)`,
      detail: keys.map((k) => `  - ${k}`).join('\n') + '\n',
      fix: 'break the new cycle (extract the shared piece, or invert one dependency), then retry.',
      minTier: 'strict',
    });
  }
  try {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${d.newBaseline}\n`);
  } catch (_) { /* best effort */ }
}

function checkCouplingRatchet(ctx) {
  const { unstableHubKeys } = require('./coupling-gate');
  const { gateDecision } = require('./cycle-gate');
  const { projectDir } = ctx;
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const baselinePath = path.join(projectDir, '.claude', 'state', 'coupling-baseline.txt');
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (_) {
    noteSkip('coupling-ratchet', 'no code-graph (run /code-map or /brownfield first)');
    return;
  }
  let prevIds;
  try {
    prevIds = fs.readFileSync(baselinePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    prevIds = undefined;
  }
  const keys = unstableHubKeys(graph);
  // Reuse cycle gateDecision on counts (same as scripts/coupling-gate.js)
  const d = gateDecision(keys, prevIds === undefined ? undefined : prevIds.length);
  if (d.blocked) {
    const prevSet = new Set(prevIds || []);
    const newIds = keys.filter((id) => !prevSet.has(id));
    const hubs = ((((graph || {}).metrics) || {}).unstable_hubs)
      || ((((graph || {}).metrics) || {}).hubs)
      || [];
    const hubDetail = (id) => {
      const h = hubs.find((x) => x.id === id);
      if (!h) return `  - ${id}`;
      return `  - ${id} (fan_in=${h.fan_in}, instability=${Number(h.instability).toFixed(2)})`;
    };
    failBlock({
      id: 'coupling-ratchet',
      title: `unstable-hub count increased ${d.baseline} -> ${d.count} (the ratchet only goes down)`,
      detail: newIds.map(hubDetail).join('\n') + '\n',
      fix:
        "extract a narrower interface for each hub above so its dependents stop coupling to " +
        "the file's full surface — split responsibilities, or introduce a facade exposing only the " +
        'members callers actually use. Either move lowers fan-in without touching every caller at once. Then retry.',
      minTier: 'strict',
    });
  }
  try {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, keys.length ? `${keys.join('\n')}\n` : '');
  } catch (_) { /* best effort */ }
}

module.exports = {
  checkCycleDetection,
  checkCouplingRatchet,
};
