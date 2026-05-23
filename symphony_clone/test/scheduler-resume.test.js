'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Scheduler } = require('../src/orchestrator/scheduler');

const baseConfig = {
  tracker: {
    readyState: 'Ready for Agent',
    runningState: 'In Progress',
    readyLabel: 'agent-ready',
    terminalStates: ['Done', 'Canceled']
  },
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000 },
  maxConcurrentRuns: 1,
  workspaceRetention: 'delete',
  github: { createPr: false, baseBranch: 'main', branchPrefix: 'agent' }
};

test('runIssue logs workspace_resumed BEFORE stateStore.updateRun', async () => {
  const events = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-resume-'));
  const workspacePath = path.join(tempRoot, 'ENG-303');
  fs.mkdirSync(path.join(workspacePath, '.claude/state/tracker-runs/A'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, '.claude/state/tracker-runs/A/result.json'),
    JSON.stringify({ group: 'A', status: 'blocked', summary: 'irrelevant for this test' })
  );

  const tracker = {
    listCandidates: async () => [],
    moveIssue: async () => {},
    addComment: async () => {}
  };
  const stateStore = {
    nextAttempt: () => 2,
    startRun: () => {},
    updateRun: () => { events.push('updateRun'); },
    finishRun: () => {},
    recordFailure: () => ({ status: 'retry_wait' }),
    dueForRetry: () => true
  };
  const logger = {
    info: (event) => { if (event === 'workspace_resumed') events.push('log:workspace_resumed'); },
    warn: () => {},
    error: () => {}
  };
  const workspaceManager = {
    prepare: async () => ({
      workspacePath,
      branchName: 'agent/ENG-303',
      workspaceKey: 'ENG-303',
      resumed: true,
      commitsAhead: 4,
      backupRef: 'recovery/agent/ENG-303/attempt-2-1234-abcdef01'
    }),
    pushBranch: async () => {},
    cleanup: async () => {}
  };
  const claudeRunner = { run: async () => ({ stdout: '', stderr: '' }) };

  const scheduler = new Scheduler({
    config: baseConfig, tracker, stateStore, claudeRunner, workspaceManager, logger
  });

  await scheduler.runIssue({
    id: 'i303', key: 'ENG-303',
    state: 'Ready for Agent', labels: ['agent-ready'], blockedBy: [],
    description: 'Group: A\nStories: S1'
  });

  const logIdx = events.indexOf('log:workspace_resumed');
  const updateIdx = events.indexOf('updateRun');
  assert.ok(logIdx > -1, 'workspace_resumed must be logged on a resumed prepare()');
  assert.ok(updateIdx > -1, 'updateRun must still be called');
  assert.ok(logIdx < updateIdx, `workspace_resumed (${logIdx}) must fire before updateRun (${updateIdx})`);
});

test('runIssue does NOT pass recoveryTag to updateRun on a non-resumed prepare()', async () => {
  const payloads = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-resume-'));
  const workspacePath = path.join(tempRoot, 'ENG-404');
  fs.mkdirSync(path.join(workspacePath, '.claude/state/tracker-runs/A'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, '.claude/state/tracker-runs/A/result.json'),
    JSON.stringify({ group: 'A', status: 'blocked', summary: 'irrelevant' })
  );

  const tracker = { listCandidates: async () => [], moveIssue: async () => {}, addComment: async () => {} };
  const stateStore = {
    nextAttempt: () => 1,
    startRun: () => {},
    updateRun: (_, payload) => { payloads.push(payload); },
    finishRun: () => {},
    recordFailure: () => ({ status: 'retry_wait' }),
    dueForRetry: () => true
  };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const workspaceManager = {
    prepare: async () => ({
      workspacePath,
      branchName: 'agent/ENG-404',
      workspaceKey: 'ENG-404',
      resumed: false
    }),
    pushBranch: async () => {},
    cleanup: async () => {}
  };
  const claudeRunner = { run: async () => ({ stdout: '', stderr: '' }) };

  const scheduler = new Scheduler({
    config: baseConfig, tracker, stateStore, claudeRunner, workspaceManager, logger
  });

  await scheduler.runIssue({
    id: 'i404', key: 'ENG-404',
    state: 'Ready for Agent', labels: ['agent-ready'], blockedBy: [],
    description: 'Group: A\nStories: S1'
  });

  assert.ok(payloads.length > 0, 'updateRun must be called');
  const first = payloads[0];
  assert.equal('recoveryTag' in first, false, 'recoveryTag must be absent on non-resumed runs (no partial-write)');
});
