'use strict';

// Contract for pod mode (#2): cross-group fan-out where each cluster raises its
// own PR instead of rolling up to trunk. Pins the prose so the per-cluster-PR
// behavior, per-cluster verification, and conflict-avoidance rules don't regress.

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

test('pod mode raises a PR per cluster and does NOT roll up to trunk', () => {
  const a = read(AUTO);
  assert.match(a, /gh pr create --draft/);
  assert.match(a, /own draft PR/i);
  assert.match(a, /does \*\*not\*\* merge|does NOT merge|replaced by/i);
  // dependent clusters wait for predecessor PRs to merge, then rebase
  assert.match(a, /wait for this wave's PRs to merge|predecessor PRs to merge/i);
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

test('/build surfaces --pod and supersedes the single integrated PR in pod mode', () => {
  const b = read(BUILD);
  assert.match(b, /--pod 3/);
  assert.match(b, /Pod mode/);
  assert.match(b, /superseded|per-cluster PRs/i);
});

test('autonomous-lane documents pod fan-out with merge-between-waves', () => {
  const lane = read(LANE);
  assert.match(lane, /Pod mode/);
  assert.match(lane, /one PR per cluster|OWN draft PR/i);
  assert.match(lane, /wait for predecessor PRs to MERGE|merge between waves/i);
  assert.match(lane, /AUTO_MERGE/);
});
