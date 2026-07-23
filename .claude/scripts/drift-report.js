#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/drift-report.js
// Continuous drift monitor (gap G2) — the "repeatedly, slower cadence" sensor
// that runs OUTSIDE the change lifecycle. Reads the latest code-graph (kept
// fresh by the graph-refresh hook) plus a fresh dependency audit, diffs against
// the last snapshot, writes specs/drift/drift-report.md|json, and updates the
// snapshot. Reuses lib/drift (pure) and security-scan's runDeps (no clobber of
// the /gate report). Exit 0 = no new drift or baseline established, 1 = new
// drift detected (so cron/CI/`/schedule` can surface it).

const fs = require('fs');
const path = require('path');
// drift.js ships in the brownfield pack (it reaches into code-map to compute over the
// code-graph). A core install ships this monitor but not that pack; guard the load so the
// script is importable, and degrade the whole run when it is absent — a greenfield core
// install has no code-graph to drift against, and dependency-CVE drift is still covered by
// /gate's security scan.
let drift = null;
try { drift = require('../hooks/lib/drift'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; /* else: brownfield pack absent */ }
const canvas = require('../hooks/lib/canvas');
const { runDeps } = require('./security-scan');

const REPO = process.cwd();
const GRAPH = path.join(REPO, 'specs', 'brownfield', 'code-graph.json');
const CANVAS = path.join(REPO, 'specs', 'design', 'reasons-canvas.md');
const MARKER = path.join(REPO, '.claude', 'state', 'modularity-review-marker.json');
const OUT_DIR = path.join(REPO, 'specs', 'drift');
const SNAPSHOT = path.join(OUT_DIR, 'drift-snapshot.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function depCveKeys(cwd) {
  try {
    return runDeps(cwd).map((f) => `${f.tool}:${f.rule}`);
  } catch (_) {
    return [];
  }
}

// Governed paths the REASONS Canvas still claims but that no longer exist.
function canvasMissing(cwd) {
  try {
    const governs = canvas.extractGoverns(fs.readFileSync(CANVAS, 'utf8'));
    return canvas.canvasMissingPaths(governs, (rel) => fs.existsSync(path.join(cwd, rel)));
  } catch (_) {
    return [];
  }
}

// The unstable-hub set as of the last REAL modularity review (gap G19),
// written by record-modularity-review.js after /brownfield --full's Step 3.6
// or /design --delta's Step D3.5. Degrade loudly, never silently, when no
// marker exists yet — that is itself a real, actionable signal, not a
// missing file to shrug off.
function modularityMarkerHubIds() {
  const marker = readJson(MARKER);
  if (!marker) {
    process.stderr.write(
      'WARNING: drift monitor — no modularity-review marker at ' +
      '.claude/state/modularity-review-marker.json. No real modularity review ' +
      'has ever run — consider `/brownfield --full` or `/design --delta`. ' +
      'Every currently unstable hub is being treated as stale until one does.\n'
    );
    return null;
  }
  return Array.isArray(marker.unstableHubIds) ? marker.unstableHubIds : [];
}

function writeOutputs(report, payload, snapshot) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'drift-report.md'), report);
  fs.writeFileSync(path.join(OUT_DIR, 'drift-report.json'), JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
}

function currentMetrics(graph, prev) {
  let metrics = drift.extractMetrics(graph || {});
  if (!graph) metrics = drift.carryForwardArch(metrics, prev); // don't reset arch baseline on a graphless run
  metrics = drift.withCanvasDrift(drift.withDepCves(metrics, depCveKeys(REPO)), canvasMissing(REPO));
  return drift.withModularityStaleness(metrics, modularityMarkerHubIds(), metrics.unstableHubs);
}

function main() {
  if (!drift) {
    process.stderr.write(
      'drift monitor: the brownfield pack (code-graph tooling) is not installed — ' +
      'nothing to monitor. Run from a brownfield/full install to enable drift tracking.\n'
    );
    process.exit(0);
  }
  const graph = readJson(GRAPH);
  if (!graph) {
    process.stderr.write(
      'WARNING: drift monitor — no code-graph at specs/brownfield/code-graph.json. ' +
      'Architecture/dead-code drift is unavailable until /brownfield or /code-map runs; ' +
      'dependency drift still reported.\n'
    );
  }
  const prev = readJson(SNAPSHOT);
  const curr = currentMetrics(graph, prev);
  const diff = drift.diffSnapshots(prev, curr);
  const report = drift.renderDriftReport(diff, curr);
  writeOutputs(report, { diff, snapshot: curr }, curr);

  process.stdout.write(report);
  process.exit(drift.hasRegressed(diff) ? 1 : 0);
}

main();
