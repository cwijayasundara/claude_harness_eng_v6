'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  stampPlanningProgress,
  latestPlanningPhase,
  implementationStarted,
} = require('../.claude/scripts/planning-progress');
const { buildSnapshot } = require('../.claude/scripts/pipeline-snapshot');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'planning-progress-'));
}

test('stampPlanningProgress rewrites next_action after spec approval', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'claude-progress.txt'), 'next_action: Run /brd to start\n');
  assert.strictEqual(stampPlanningProgress(root, 'spec'), 'Run /design');
  assert.match(fs.readFileSync(path.join(root, 'claude-progress.txt'), 'utf8'), /Run \/design/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('latestPlanningPhase follows the last approved receipt', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'specs/reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs/reviews/brd-approval.json'), '{"status":"approved"}');
  fs.writeFileSync(path.join(root, 'specs/reviews/spec-approval.json'), '{"status":"approved"}');
  assert.strictEqual(latestPlanningPhase(root), 'spec');
  fs.rmSync(root, { recursive: true, force: true });
});

test('buildSnapshot does not fail a planning project on the 80% coverage seed', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude/state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude/state/coverage-baseline.txt'), '80\n');
  fs.writeFileSync(path.join(root, 'claude-progress.txt'), [
    '=== Session 0 ===',
    'groups_completed: []',
    'groups_remaining: []',
    'current_group: none',
    'coverage: 0%',
    'next_action: Run /design',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'specs/reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs/reviews/spec-approval.json'), '{"status":"approved"}');
  fs.writeFileSync(path.join(root, 'features.json'), '[]\n');
  const snap = buildSnapshot(root);
  assert.strictEqual(snap.phase, 'spec');
  assert.strictEqual(snap.health, 'on_track');
  assert.strictEqual(snap.next_action, 'Run /design');
  fs.rmSync(root, { recursive: true, force: true });
});

test('implementationStarted is false until a group is active', () => {
  assert.strictEqual(implementationStarted({ current_group: 'none', groups_completed: '[]' }), false);
  assert.strictEqual(implementationStarted({ current_group: 'B', groups_completed: '[A]' }), true);
});
