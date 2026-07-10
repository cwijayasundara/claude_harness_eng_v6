'use strict';

// Contract for full-auto (#3): --auto = --autonomous minus the Phase 3.5 plan
// gate. PRD straight to PR(s), zero build-time human gates, machine gates intact,
// merge stays the (human or AUTO_MERGE) gate.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const BUILD_CORPUS = () => readSkillCorpus('build');
const LANE = '.claude/skills/build/references/autonomous-lane.md';

test('/build exposes --auto as a third (full-auto) approval model', () => {
  const b = BUILD_CORPUS();
  assert.match(b, /--auto\b/);
  assert.match(b, /Three approval models/);
  assert.match(b, /Full-auto \(`--auto`\)/);
});

test('full-auto is semi-auto minus the Phase 3.5 plan gate (zero build-time gates)', () => {
  const b = BUILD_CORPUS();
  assert.match(b, /Skipped entirely in `--auto`/);
  assert.match(b, /zero.*human gates|no human stops at all/i);
  // the merge gate is the one retained human touchpoint
  assert.match(b, /merge gate/i);
});

test('full-auto keeps the machine gates and never opens a PR over a red build', () => {
  const b = BUILD_CORPUS();
  assert.match(b, /independent of the generator/i);
  assert.match(b, /no PR is ever opened over a red build/i);
  // and the gotcha forbids weakening gates to make it run
  assert.match(b, /never weaken them|zero.*human gates before the PR/i);
});

test('full-auto still grounds on a PRD (no headless interview, scope-hallucination guard)', () => {
  const b = BUILD_CORPUS();
  assert.match(b, /`--autonomous` and `--auto` mode the input requirements/);
  assert.match(b, /no plan gate to catch a hallucinated scope/i);
});

test('autonomous-lane documents the semi-vs-full-auto difference', () => {
  const lane = read(LANE);
  assert.match(lane, /semi-auto.*full-auto|full-auto \(`--auto`\)/i);
  assert.match(lane, /Phase 3\.5 is \*\*skipped\*\*|skipped/i);
  assert.match(lane, /AUTO_MERGE/);
});
