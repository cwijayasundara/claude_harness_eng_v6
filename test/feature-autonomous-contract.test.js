'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const FEATURE = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'feature', 'SKILL.md'), 'utf8',
);

test('/feature documents the --autonomous and --auto lanes via feature-lane.js', () => {
  assert.match(FEATURE, /--autonomous/);
  assert.match(FEATURE, /--auto\b/);
  assert.match(FEATURE, /feature-lane\.js/);
});

test('autonomous lanes use the deterministic seam-confidence gate', () => {
  assert.match(FEATURE, /seam-confidence\.js/);
});

test('machine adherence replaces the human GATE 2 in autonomous lanes', () => {
  assert.match(FEATURE, /brownfield-adherence|adherence rubric/i);
  assert.match(FEATURE, /replaces?.*GATE 2|GATE 2.*machine|machine.*adherence/i);
});

test('low seam-confidence in --auto stops and surfaces a report', () => {
  assert.match(FEATURE, /adherence-report\.md/);
  assert.match(FEATURE, /stop|surface/i);
});

test('every lane still stops at the open PR (human merges)', () => {
  assert.match(FEATURE, /stop at .*PR|merge stays human|human (owns|merges)/i);
});
