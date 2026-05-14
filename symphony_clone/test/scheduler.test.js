'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler, isEligible, isStuck } = require('../src/orchestrator/scheduler');

const config = {
  tracker: {
    readyState: 'Ready for Agent',
    runningState: 'In Progress',
    readyLabel: 'agent-ready',
    terminalStates: ['Done', 'Canceled']
  },
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000 },
  maxConcurrentRuns: 1
};

test('isEligible accepts ready labeled issue with terminal blockers', () => {
  const issue = {
    state: 'Ready for Agent',
    labels: ['agent-ready'],
    blockedBy: [{ state: 'Done' }]
  };

  assert.equal(isEligible(issue, config), true);
});

test('isEligible rejects issue with active blocker', () => {
  const issue = {
    state: 'Ready for Agent',
    labels: ['agent-ready'],
    blockedBy: [{ state: 'In Progress' }]
  };

  assert.equal(isEligible(issue, config), false);
});

test('isEligible rejects issue without ready label', () => {
  const issue = {
    state: 'Ready for Agent',
    labels: ['other'],
    blockedBy: []
  };

  assert.equal(isEligible(issue, config), false);
});

test('isStuck detects in-progress issue not claimed by this process', () => {
  const issue = { id: 'i1', state: 'In Progress' };
  assert.equal(isStuck(issue, new Set(), config), true);
});

test('isStuck ignores in-progress issue claimed by this process', () => {
  const issue = { id: 'i1', state: 'In Progress' };
  assert.equal(isStuck(issue, new Set(['i1']), config), false);
});

test('isStuck ignores non-running states', () => {
  const issue = { id: 'i1', state: 'Ready for Agent' };
  assert.equal(isStuck(issue, new Set(), config), false);
});

test('reclaimStuck resets abandoned issues and records failure', async () => {
  const moved = [];
  const comments = [];
  const tracker = {
    listCandidates: async () => [],
    moveIssue: async (id, state) => { moved.push({ id, state }); },
    addComment: async (id, body) => { comments.push({ id, body }); }
  };
  const recorded = [];
  const stateStore = {
    recordFailure: (issue, error, options) => {
      recorded.push({ key: issue.key, error: error.message, options });
      return { status: 'retry_wait', attempt: 1 };
    },
    dueForRetry: () => true
  };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const scheduler = new Scheduler({ config, tracker, stateStore, logger });

  const candidates = [
    { id: 'i1', key: 'RES-21', state: 'In Progress', labels: [], blockedBy: [] },
    { id: 'i2', key: 'RES-22', state: 'Ready for Agent', labels: [], blockedBy: [] }
  ];

  const reclaimed = await scheduler.reclaimStuck(candidates);

  assert.equal(reclaimed, 1);
  assert.deepEqual(moved, [{ id: 'i1', state: 'Ready for Agent' }]);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].id, 'i1');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].key, 'RES-21');
  assert.match(recorded[0].error, /abandoned/);
});

test('reclaimStuck skips issues claimed in-process', async () => {
  const moved = [];
  const tracker = {
    listCandidates: async () => [],
    moveIssue: async (id, state) => { moved.push({ id, state }); },
    addComment: async () => {}
  };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const scheduler = new Scheduler({ config, tracker, logger });
  scheduler.running.add('i1');

  const reclaimed = await scheduler.reclaimStuck([
    { id: 'i1', key: 'RES-21', state: 'In Progress', labels: [], blockedBy: [] }
  ]);

  assert.equal(reclaimed, 0);
  assert.equal(moved.length, 0);
});

test('tick launches up to maxConcurrentRuns eligible issues in parallel', async () => {
  const parallelConfig = { ...config, maxConcurrentRuns: 3 };
  const eligible = (n) => ({
    id: `id-${n}`,
    key: `RES-${n}`,
    state: 'Ready for Agent',
    labels: ['agent-ready'],
    blockedBy: [],
    description: 'Group: G' + n + '\nStories: S1'
  });
  const tracker = {
    listCandidates: async () => [eligible(1), eligible(2), eligible(3), eligible(4), eligible(5)],
    moveIssue: async () => { await new Promise((r) => setTimeout(r, 50)); },
    addComment: async () => {}
  };
  const stateStore = {
    nextAttempt: () => 1,
    startRun: () => {},
    updateRun: () => {},
    finishRun: () => {},
    recordFailure: () => ({ status: 'retry_wait' }),
    getRun: () => null,
    dueForRetry: () => true
  };
  const claudeRunner = { run: async () => { await new Promise((r) => setTimeout(r, 200)); return { stdout: '', stderr: '' }; } };
  const workspaceManager = { prepare: async () => ({ workspacePath: '/w', branchName: 'b', workspaceKey: 'k' }), pushBranch: async () => {} };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const scheduler = new Scheduler({ config: parallelConfig, tracker, stateStore, claudeRunner, workspaceManager, logger });

  const result = await scheduler.tick();

  assert.equal(result.started, 3);
  assert.equal(scheduler.running.size, 3);
});

test('tick reports reclaimed count and starts no runs when only stuck candidates exist', async () => {
  const tracker = {
    listCandidates: async () => [
      { id: 'i1', key: 'RES-21', state: 'In Progress', labels: ['agent-ready'], blockedBy: [] }
    ],
    moveIssue: async () => {},
    addComment: async () => {}
  };
  const stateStore = {
    recordFailure: () => ({ status: 'retry_wait', attempt: 1 }),
    dueForRetry: () => true
  };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const scheduler = new Scheduler({ config, tracker, stateStore, logger });

  const result = await scheduler.tick();

  assert.equal(result.reclaimed, 1);
  assert.equal(result.started, 0);
});
