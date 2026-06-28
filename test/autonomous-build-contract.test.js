'use strict';

// Contract for the --autonomous lane: plan-approve-once, a shape-aware pre-PR
// deploy/API/E2E/repair gate, and a PR raised only on green. Pins the prose so
// the autonomous path and its safety properties don't silently regress.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const BUILD = '.claude/skills/build/SKILL.md';
const LANE = '.claude/skills/build/references/autonomous-lane.md';

test('/build exposes --autonomous with a plan-approve-once model', () => {
  const b = read(BUILD);
  assert.match(b, /--autonomous/);
  assert.match(b, /## Approval model/);
  assert.match(b, /plan-approve-once|approve.*once/i);
});

test('autonomous mode collapses Phases 1-3 into a single consolidated plan gate', () => {
  const b = read(BUILD);
  assert.match(b, /Phase 3\.5 — Consolidated Plan Approval/);
  // the three per-phase gates must each note the autonomous deferral
  const deferrals = b.match(/In `--autonomous` mode/g) || [];
  assert.ok(deferrals.length >= 3, `expected >=3 autonomous-mode deferral notes, got ${deferrals.length}`);
});

test('Phase 9.5 deploys locally then runs API tests BEFORE E2E, shape-aware, with a fix loop', () => {
  const b = read(BUILD);
  assert.match(b, /Phase 9\.5 — Pre-PR Verification/);
  assert.match(b, /shape-aware/i);
  assert.match(b, /Deploy locally/i);
  // API-before-E2E ordering must be explicit
  const apiIdx = b.indexOf('API tests (if');
  const e2eIdx = b.indexOf('Playwright E2E (if');
  assert.ok(apiIdx > 0 && e2eIdx > 0 && apiIdx < e2eIdx, 'API tests must be ordered before Playwright E2E');
  assert.match(b, /Defect-repair loop/i);
  assert.match(b, /fix the \*\*implementation\*\*|not the test/i);
});

test('Phase 11 raises a PR only when green; merge stays human unless AUTO_MERGE', () => {
  const b = read(BUILD);
  assert.match(b, /Phase 11 — Raise PR/);
  assert.match(b, /gh pr create/);
  assert.match(b, /only.*green|gated on all-green/i);
  // "Do not merge." absolute replaced by AUTO_MERGE opt-out (Task 4)
  assert.match(b, /merge stays human|unless.*AUTO_MERGE|AUTO_MERGE.*unless/i);
});

test('the lane keeps verification independent of the generator (anti-self-approval)', () => {
  const lane = read(LANE);
  assert.match(lane, /never approves its own output|independent of (it|the generator)/i);
  assert.match(lane, /evaluator agent.*oracle|oracle for pass\/fail/i);
});

test('autonomous-lane reference exists and documents both trigger modes', () => {
  const lane = read(LANE);
  assert.match(lane, /plan-approve-once/i);
  assert.match(lane, /symphony/i); // tracker-driven trigger shares the same tail
  assert.match(lane, /AUTO_MERGE/);
});
