#!/usr/bin/env node

'use strict';

// Marker-writing half of gap G19 (modularity-review-staleness). A real
// modularity review (inferential — /brownfield --full's Step 3.6, or
// /design --delta's Step D3.5) is manually/human-triggered and produces no
// periodic signal of its own. This script wraps that review's completion:
// given the live code-graph, it records {timestamp, unstableHubIds} — the
// unstable-hub set AT THE MOMENT the real review ran — so drift-report.js's
// staleness sensor can later tell which unstable hubs are new since that
// review. Same "wrap another tool's output into a state file" pattern
// record-coverage-verdict.js (gap G17) uses for coverage_map.py.
//
// CLI: node .claude/scripts/record-modularity-review.js
//        [--root DIR] [--graph specs/brownfield/code-graph.json]
//        [--out .claude/state/modularity-review-marker.json]
//        [--scope-path PATH ...]
// --scope-path (repeatable): pass the amendment's touched-scope path list
// from /design --delta Step D3.5's scoped review. Omit it entirely for a
// full /brownfield --full review. With it, only currently-unstable hubs
// whose path is in scope get newly marked reviewed; a hub outside scope
// keeps whatever status it already had (still stale if it was never
// reviewed before) instead of being silently marked reviewed by a pass that
// never looked at it.

const fs = require('fs');
const path = require('path');
const { hubsForStabilityCheck } = require('../hooks/lib/drift');

const DEFAULT_GRAPH = path.join('specs', 'brownfield', 'code-graph.json');
const DEFAULT_OUT = path.join('.claude', 'state', 'modularity-review-marker.json');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function argAll(argv, name) {
  const out = [];
  argv.forEach((a, i) => {
    if (a === name) out.push(argv[i + 1]);
  });
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// Which currently-unstable hubs did THIS review actually look at? A full
// review (no scopePaths) looked at everything currently unstable. A scoped
// review (/design --delta Step D3.5) only judged entries overlapping the
// amendment's touched-scope paths — map hub id -> path via graph.nodes.
function reviewedHubIds(graph, currentUnstableIds, scopePaths) {
  if (!scopePaths || !scopePaths.length) return new Set(currentUnstableIds);
  const scopeSet = new Set(scopePaths);
  const pathById = new Map();
  for (const node of (graph && graph.nodes) || []) {
    if (node.path) pathById.set(node.id, node.path);
  }
  return new Set(currentUnstableIds.filter((id) => scopeSet.has(pathById.get(id))));
}

// Pure core: a code-graph -> the marker payload. Exported for tests.
//
// A scoped review (opts.scopePaths set) must not silently clear staleness
// for hubs it never looked at: only currently-unstable hubs that were either
// just reviewed (in scope) or already recorded in the PRIOR marker survive
// into the new one. A full review (no scopePaths) reduces to today's plain
// overwrite, since "reviewed" then covers every currently-unstable hub.
function buildMarker(graph, now, opts) {
  const o = opts || {};
  const currentUnstable = hubsForStabilityCheck(graph);
  const reviewed = reviewedHubIds(graph, currentUnstable, o.scopePaths);
  const prevIds = new Set((o.prevMarker && o.prevMarker.unstableHubIds) || []);
  const survivors = currentUnstable.filter((id) => reviewed.has(id) || prevIds.has(id));
  return { timestamp: now, unstableHubIds: survivors.sort() };
}

function writeMarker(outPath, marker) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(marker, null, 2) + '\n');
}

function run(argv, deps) {
  const now = (deps && deps.now) || (() => new Date().toISOString());
  const root = arg(argv, '--root', process.cwd());
  const graphPath = path.resolve(root, arg(argv, '--graph', DEFAULT_GRAPH));
  const outPath = path.resolve(root, arg(argv, '--out', DEFAULT_OUT));

  const graph = readJson(graphPath);
  if (!graph) {
    process.stderr.write(
      `record-modularity-review: no code-graph at ${graphPath} — nothing recorded. ` +
      'Run /brownfield or /code-map first.\n'
    );
    return 1;
  }

  const scopePaths = argAll(argv, '--scope-path');
  const prevMarker = readJson(outPath);
  const marker = buildMarker(graph, now(), { scopePaths, prevMarker });
  writeMarker(outPath, marker);
  process.stdout.write(
    `record-modularity-review: marker written to ${outPath} ` +
    `(${marker.unstableHubIds.length} unstable hub(s) at review time).\n`
  );
  return 0;
}

module.exports = { buildMarker, writeMarker, run };

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
