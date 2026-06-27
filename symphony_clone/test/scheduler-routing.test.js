'use strict';

// Task 4: feature routing tests for Scheduler.dispatchIssue + runFeatureIssue

const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler: Sched } = require('../src/orchestrator/scheduler');

const routingConfig = {
  tracker: {
    readyState: 'Ready for Agent', runningState: 'In Progress',
    readyLabel: 'agent-ready', planLabel: 'agent-plan', featureLabel: 'agent-feature',
    terminalStates: ['Done', 'Canceled'],
  },
  retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
  maxConcurrentRuns: 1, workspaceRetention: 'delete',
};

function routingScheduler() {
  return new Sched({
    config: routingConfig,
    tracker: { listCandidates: async () => [], moveIssue: async () => {}, addComment: async () => {} },
    workspaceManager: { prepare: async () => ({ workspacePath: '/tmp/x', branchName: 'b' }) },
    claudeRunner: { run: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

test('dispatchIssue routes by issueKind: feature -> runFeatureIssue', () => {
  const sched = routingScheduler();
  const calls = [];
  sched.runPlanningIssue = () => calls.push('plan');
  sched.runFeatureIssue = () => calls.push('feature');
  sched.runIssue = () => calls.push('execute');
  sched.dispatchIssue({ labels: ['agent-feature'] });
  sched.dispatchIssue({ labels: ['agent-plan'] });
  sched.dispatchIssue({ labels: ['agent-ready'] });
  assert.deepEqual(calls, ['feature', 'plan', 'execute']);
});

test('runFeatureIssue wires group=issue.key, buildFeaturePrompt, finishExecution', () => {
  const sched = routingScheduler();
  let captured;
  sched.claimAndRun = (_issue, opts) => { captured = opts; };
  sched.runFeatureIssue({ key: 'BUG-1', title: 'fix x', labels: ['agent-feature'] });
  assert.equal(captured.group.id, 'BUG-1');
  assert.match(captured.buildPrompt({ key: 'BUG-1', title: 'fix x' }), /\/feature "fix x" --auto/);
});
