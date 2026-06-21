'use strict';

// Guards the Grafana "SDLC Pipeline Progress" dashboard (Part C of the
// pipeline-progress proposal): it must be valid, auto-provisioned, and query
// only metrics the harness actually emits — so the dashboard and the metric
// emitters cannot silently drift apart.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'telemetry', 'grafana', 'dashboards', 'pipeline-progress.json');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function exprs(dashboard) {
  return dashboard.panels.flatMap((p) => (p.targets || []).map((t) => t.expr));
}

test('the dashboard is valid JSON with an identity Grafana can provision', () => {
  assert.ok(fs.existsSync(DASH), 'pipeline-progress.json must live in the provisioned dashboards dir');
  const dash = JSON.parse(read(DASH));
  assert.ok(dash.uid, 'needs a uid so it is addressable (e2e getDashboard / linking)');
  assert.match(dash.title, /pipeline progress/i);
  assert.ok(Array.isArray(dash.panels) && dash.panels.length > 0, 'must have panels');
});

test('the dashboard surfaces the pipeline-progress gauges and live state metrics', () => {
  const all = exprs(JSON.parse(read(DASH))).join('\n');
  for (const metric of [
    'harness_features_passing',
    'harness_coverage',
    'harness_pending_reviews',
    'harness_iteration_current',
    'harness_story_active',
  ]) {
    assert.match(all, new RegExp(metric), `dashboard must chart ${metric}`);
  }
});

// Every harness_* metric the dashboard queries must be one the harness emits —
// from telemetry-memory's ledger snapshot or the pipeline gauges module. A typo
// or a renamed metric would otherwise produce a silently empty panel.
test('every harness_* metric charted is actually emitted somewhere', () => {
  const emitters = [
    read(path.join(ROOT, '.claude', 'scripts', 'telemetry-memory.js')),
    read(path.join(ROOT, '.claude', 'scripts', 'telemetry-pipeline-gauges.js')),
    read(path.join(ROOT, '.claude', 'scripts', 'telemetry-phase-eval.js')),
  ].join('\n');

  const charted = new Set(
    exprs(JSON.parse(read(DASH)))
      .join('\n')
      .match(/harness_[a-z_]+/g) || []
  );
  const missing = [...charted].filter((m) => !emitters.includes(m));
  assert.deepStrictEqual(missing, [], `dashboard charts metrics nothing emits: ${missing.join(', ')}`);
});
