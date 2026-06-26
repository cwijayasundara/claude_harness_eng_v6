'use strict';

// Contract for pod mode (#2): cross-group fan-out where each cluster raises its
// own stacked PR immediately — no merge wait. Pins the prose so the per-cluster-PR
// behavior (stacked branches, no merge wait), per-cluster verification, and
// conflict-avoidance rules don't regress.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AUTO = '.claude/skills/auto/SKILL.md';
const BUILD = '.claude/skills/build/SKILL.md';
const LANE = '.claude/skills/build/references/autonomous-lane.md';

test('/auto exposes --pod with a dedicated Pod mode section', () => {
  const a = read(AUTO);
  assert.match(a, /--pod N/);
  assert.match(a, /### Pod mode/);
  assert.match(a, /implies `--parallel-groups/);
});

test('pod mode raises a PR per cluster via wave-pr.js and does NOT wait for merges', () => {
  const a = read(AUTO);
  // PRs are opened via wave-pr.js (not gh pr create --draft directly)
  assert.match(a, /wave-pr\.js/);
  // PR granularity decided by wave-plan.js
  assert.match(a, /wave-plan\.js/);
  // each cluster gets its own stacked draft PR
  assert.match(a, /stacked draft PR/i);
  // the parent does NOT merge
  assert.match(a, /does \*\*not\*\* merge|does NOT merge/i);
  // negative: old merge-wait semantics must not appear
  assert.doesNotMatch(a, /wait for .*PRs to merge/i);
});

test('pod mode verifies each cluster (Phase 9.5 scoped) before its PR', () => {
  const a = read(AUTO);
  assert.match(a, /Phase 9\.5 pre-PR ladder/i);
  assert.match(a, /scoped to (its|that) cluster|for THIS cluster/i);
  assert.match(a, /does \*\*not\*\* open a PR|do NOT open a PR/i);
});

test('pod mode documents the structural conflict defense (disjoint ownership + foundation-first)', () => {
  const a = read(AUTO);
  assert.match(a, /disjoint file ownership/i);
  assert.match(a, /foundation clusters/i);
  assert.match(a, /23%/);
});

test('/auto documents --single-pr flag and forwards it to wave-plan.js', () => {
  const a = read(AUTO);
  assert.match(a, /--single-pr/);
  assert.match(a, /wave-plan\.js.*--single-pr|--single-pr.*wave-plan\.js/s);
});

test('/build documents --single-pr forwarding to /auto', () => {
  const b = read(BUILD);
  assert.match(b, /--single-pr/);
});

test('/build surfaces --pod and supersedes the single integrated PR in pod mode', () => {
  const b = read(BUILD);
  assert.match(b, /--pod 3/);
  assert.match(b, /Pod mode/);
  assert.match(b, /superseded|per-cluster PRs/i);
});

test('autonomous-lane documents pod fan-out with stacked PRs and no merge wait', () => {
  const lane = read(LANE);
  assert.match(lane, /Pod mode/);
  // documents stacked / per-cluster PRs
  assert.match(lane, /stacked.*PR|OWN stacked draft PR|one PR per cluster/i);
  // negative: old merge-between-waves wait must not appear
  assert.doesNotMatch(lane, /wait for predecessor PRs to MERGE|merge between waves/i);
  // AUTO_MERGE still mentioned
  assert.match(lane, /AUTO_MERGE/);
});
