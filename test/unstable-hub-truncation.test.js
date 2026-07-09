'use strict';

// Gap G26: graph_metrics.py's _hubs() truncates metrics.hubs to the top 25 by
// fan-in for the human-facing coupling report. Threshold-based consumers
// (coupling-gate.js's ratchet, drift.js's staleness tracking,
// agent-readiness's modularity-freshness pillar, record-modularity-review.js's
// marker) reused that same capped list for an unstable-hub CHECK it wasn't
// designed for, so a real unstable hub ranked 26th+ by fan-in was invisible
// to all of them. graph_metrics.py now also emits an uncapped
// metrics.unstable_hubs field; drift.js's new hubsForStabilityCheck prefers
// it when present and falls back to the old capped-hubs behavior otherwise.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const drift = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'drift.js'));

const REPO = path.resolve(__dirname, '..');
const INDEXER = path.join(
  REPO, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py'
);

// --- (a) a 26th-ranked unstable hub, absent from the capped `hubs` list,
// is still caught via the new `unstable_hubs` field ------------------------

function stableTopHub(i) {
  // Huge fan_in, zero fan_out: outranks every real unstable hub on fan_in
  // alone, but instability 0 means it never trips the unstable threshold.
  return { id: `src/stable-${i}.js`, fan_in: 100, fan_out: 0, instability: 0 };
}

test('hubsForStabilityCheck catches a 26th-ranked unstable hub the capped hubs list excludes', () => {
  const cappedHubs = Array.from({ length: 25 }, (_, i) => stableTopHub(i));
  const buriedHub = { id: 'src/buried-hub.js', fan_in: 5, fan_out: 45, instability: 0.9 };
  const graph = {
    metrics: {
      hubs: cappedHubs, // simulates the real top-25-by-fan-in truncation
      unstable_hubs: [buriedHub], // the new uncapped, pre-thresholded field
    },
  };

  // The bug, reproduced: the old path (unstableHubIds over the capped list)
  // sees nothing, because buriedHub never made it into the top 25.
  assert.deepStrictEqual(drift.unstableHubIds(graph.metrics.hubs), []);

  // The fix: the new helper reads the uncapped field instead.
  assert.deepStrictEqual(drift.hubsForStabilityCheck(graph), ['src/buried-hub.js']);
});

// --- (b) no unstable_hubs field (older-format graph) falls back exactly to
// the pre-G26 capped-hubs behavior, unchanged ------------------------------

test('hubsForStabilityCheck falls back to unstableHubIds(hubs) when unstable_hubs is absent', () => {
  const hubs = [
    { id: 'src/a.js', fan_in: 9, fan_out: 1, instability: 0.1 },
    { id: 'src/b.js', fan_in: 8, fan_out: 30, instability: 0.9 },
  ];
  const graph = { metrics: { hubs } };
  assert.deepStrictEqual(drift.hubsForStabilityCheck(graph), drift.unstableHubIds(hubs));
  assert.deepStrictEqual(drift.hubsForStabilityCheck(graph), ['src/b.js']);
});

test('hubsForStabilityCheck tolerates a missing graph/metrics entirely', () => {
  assert.deepStrictEqual(drift.hubsForStabilityCheck({}), []);
  assert.deepStrictEqual(drift.hubsForStabilityCheck(null), []);
});

// --- (c) real round-trip: code_index.py's actual Python output really does
// emit an uncapped unstable_hubs field when the repo has >25 unstable files.
// Not a hand-built JS fixture — the same real-artifact discipline
// coverage-map.test.js's makeProject()/runMap() round trip already applies.

const LEAF_COUNT = 20; // fan_out target per hub: 20 leaf imports
const HUB_COUNT = 30; // > 25, to prove the cap no longer hides any of them
const CALLER_COUNT = 5; // fan_in target per hub: 5 caller imports

function writeLeaf(dir, i) {
  fs.writeFileSync(path.join(dir, `leaf${i}.py`), 'def noop():\n    return None\n');
}

function writeHub(dir, i) {
  const imports = Array.from({ length: LEAF_COUNT }, (_, j) => `import leaf${j}`).join('\n');
  fs.writeFileSync(path.join(dir, `u${i}.py`), `${imports}\n\n\ndef run():\n    return leaf0.noop()\n`);
}

function writeCaller(dir, i) {
  const imports = Array.from({ length: HUB_COUNT }, (_, j) => `import u${j}`).join('\n');
  fs.writeFileSync(path.join(dir, `caller${i}.py`), `${imports}\n\n\ndef run():\n    return u0.run()\n`);
}

// Builds a fixture repo where HUB_COUNT files each have fan_in=CALLER_COUNT
// (5) and fan_out=LEAF_COUNT (20) -> instability 20/25 = 0.8, exactly meeting
// hooks/lib/drift.js's UNSTABLE_FAN_IN/UNSTABLE_INSTABILITY thresholds. The
// LEAF_COUNT leaf modules have fan_in=HUB_COUNT (30) each, which outranks
// every hub file on raw fan_in and pushes most of the 30 unstable hubs out
// of the top-25 `hubs` cap — reproducing the real-world truncation.
function buildUnstableHubProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g26-hub-truncation-'));
  for (let i = 0; i < LEAF_COUNT; i++) writeLeaf(dir, i);
  for (let i = 0; i < HUB_COUNT; i++) writeHub(dir, i);
  for (let i = 0; i < CALLER_COUNT; i++) writeCaller(dir, i);
  return dir;
}

test('graph_metrics.py emits unstable_hubs with more than 25 entries on a real >25-unstable-hub repo', () => {
  const dir = buildUnstableHubProject();
  const out = path.join(dir, 'specs', 'brownfield', 'code-graph.json');
  const res = spawnSync('python3', [INDEXER, '--root', dir, '--out', out], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);

  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(Array.isArray(graph.metrics.unstable_hubs), 'metrics.unstable_hubs must exist');
  assert.strictEqual(graph.metrics.unstable_hubs.length, HUB_COUNT);
  assert.ok(graph.metrics.hubs.length <= 25, 'metrics.hubs must stay capped, unchanged');

  const hubIds = new Set(graph.metrics.hubs.map((h) => h.id));
  const unstableIds = graph.metrics.unstable_hubs.map((h) => h.id);
  assert.ok(
    unstableIds.some((id) => !hubIds.has(id)),
    'at least one unstable hub must be truncated out of the capped hubs list'
  );
  assert.deepStrictEqual(drift.hubsForStabilityCheck(graph).length, HUB_COUNT);
});
