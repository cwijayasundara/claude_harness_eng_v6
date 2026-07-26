'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
const {
  atomicWrite, createCheckpoint, loadCheckpoints, resumeDecision,
} = require('../.claude/scripts/checkpoint-state');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude/state/\n');
  fs.writeFileSync(path.join(root, 'claude-progress.txt'), 'next_action: test\n');
  fs.writeFileSync(path.join(root, 'features.json'), '[]\n');
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(stampEnvelope({
    schema_version: 1, task_id: 'CP-1', risk_tier: 'R1',
    allowed_paths: ['src/**'], forbidden_actions: [], required_evidence: [],
    required_approvals: 0, budgets: { dimensions: [{ unit: 'agents', limit: 1 }] },
  })));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

test('checkpoint chain resumes exactly and detects a partial iteration', () => {
  const root = fixture();
  createCheckpoint(root, { nextAction: 'run group A', currentGroup: 'A' });
  assert.strictEqual(resumeDecision(root).state, 'resume_exact');
  fs.writeFileSync(path.join(root, 'claude-progress.txt'), 'partial write\n');
  assert.strictEqual(resumeDecision(root).state, 'repair_partial_iteration');
  assert.deepStrictEqual(loadCheckpoints(root).errors, []);
});

test('atomic checkpoint writes preserve the prior target on injected rename failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-atomic-'));
  const file = path.join(root, 'current.json');
  fs.writeFileSync(file, 'old');
  const io = { ...fs, renameSync: () => { throw new Error('injected crash'); } };
  assert.throws(() => atomicWrite(file, 'new', io), /injected crash/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'old');
});

test('resume stops cleanly when the task budget is exhausted', () => {
  const root = fixture();
  const file = path.join(root, '.claude', 'state', 'task-envelope.json');
  const task = JSON.parse(fs.readFileSync(file, 'utf8'));
  task.budgets = { warn_at_pct: 80, dimensions: [{ unit: 'wall_clock_ms', limit: 1 }] };
  const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
  fs.writeFileSync(file, JSON.stringify(stampEnvelope({ ...task, integrity: undefined })));
  fs.writeFileSync(path.join(root, '.claude', 'state', 'budget-start'), '1000');
  createCheckpoint(root, { nextAction: 'must not dispatch' });
  assert.strictEqual(resumeDecision(root, 5000).state, 'blocked_budget_exhausted');
});
