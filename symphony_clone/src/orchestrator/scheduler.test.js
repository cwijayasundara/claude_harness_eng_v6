'use strict';

// Auto-merge behavior for the scheduler. Co-located (like claude-runner.test.js)
// so the TDD gate resolves it; the broader scheduler suite lives in test/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Scheduler, enableAutoMerge } = require('./scheduler');

// A workspace whose run reached human_review (harness gates passed) — the only
// state from which auto-merge is eligible.
function humanReviewWorkspace(key) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-am-'));
  const ws = path.join(root, key);
  fs.mkdirSync(path.join(ws, '.claude/state/tracker-runs/A'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, '.claude/state/tracker-runs/A/result.json'),
    JSON.stringify({ group: 'A', status: 'human_review', summary: 'ok', branch: `agent/${key}` })
  );
  return ws;
}

function makeDeps(ws) {
  const moved = [];
  return {
    moved,
    tracker: { listCandidates: async () => [], moveIssue: async (id, state) => { moved.push(state); }, addComment: async () => {} },
    stateStore: { nextAttempt: () => 1, startRun: () => {}, updateRun: () => {}, finishRun: () => {}, recordFailure: () => ({ status: 'retry_wait', attempt: 1 }), dueForRetry: () => true },
    claudeRunner: { run: async () => ({ stdout: '', stderr: '' }) },
    workspaceManager: { prepare: async () => ({ workspacePath: ws, branchName: 'agent/X', workspaceKey: 'X' }), pushBranch: async () => {}, cleanup: async () => {} },
    logger: { info() {}, warn() {}, error() {} }
  };
}

const baseConfig = {
  tracker: {
    readyState: 'Ready for Agent', runningState: 'In Progress', reviewState: 'Human Review', blockedState: 'Blocked',
    reviewStateCandidates: ['Human Review'], blockedStateCandidates: ['Blocked'], readyLabel: 'agent-ready', terminalStates: ['Done']
  },
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000 },
  maxConcurrentRuns: 1, workspaceRetention: 'delete',
  github: { createPr: false, baseBranch: 'main', branchPrefix: 'agent' }
};
const issue = { id: 'i1', key: 'ENG-1', state: 'Ready for Agent', labels: ['agent-ready'], blockedBy: [], description: 'Group: A\nStories: S1' };
const autoMergeOn = { enabled: true, method: 'merge', doneState: 'Done', doneStateCandidates: ['Done'] };

function build(d, config, enableAutoMergeFn) {
  return new Scheduler({ config, tracker: d.tracker, stateStore: d.stateStore, claudeRunner: d.claudeRunner, workspaceManager: d.workspaceManager, logger: d.logger, enableAutoMerge: enableAutoMergeFn });
}

test('autoMerge enabled: enables merge and moves the issue to the done state', async () => {
  const d = makeDeps(humanReviewWorkspace('ENG-1'));
  const calls = [];
  const scheduler = build(d, { ...baseConfig, autoMerge: autoMergeOn }, async (pr, cwd, cfg) => { calls.push(cfg.autoMerge.method); return { enabled: true }; });
  await scheduler.runIssue(issue);
  assert.deepEqual(calls, ['merge']);
  assert.ok(d.moved.includes('Done'), `moved: ${d.moved}`);
  assert.ok(!d.moved.includes('Human Review'), `must not also go to review: ${d.moved}`);
});

test('autoMerge enabled but enabling fails: falls back to human review', async () => {
  const d = makeDeps(humanReviewWorkspace('ENG-2'));
  const scheduler = build(d, { ...baseConfig, autoMerge: autoMergeOn }, async () => ({ enabled: false, reason: 'auto-merge not allowed on repo' }));
  await scheduler.runIssue(issue);
  assert.ok(d.moved.includes('Human Review'), `moved: ${d.moved}`);
  assert.ok(!d.moved.includes('Done'), `must not reach done on failed enable: ${d.moved}`);
});

test('autoMerge disabled: unchanged human-review behavior, merge never attempted', async () => {
  const d = makeDeps(humanReviewWorkspace('ENG-3'));
  let attempted = false;
  const scheduler = build(d, { ...baseConfig }, async () => { attempted = true; return { enabled: true }; });
  await scheduler.runIssue(issue);
  assert.equal(attempted, false);
  assert.ok(d.moved.includes('Human Review'), `moved: ${d.moved}`);
});

test('enableAutoMerge refuses when there is no real PR url (no gh call)', async () => {
  const r = await enableAutoMerge(null, '/tmp', { autoMerge: { method: 'merge' } });
  assert.equal(r.enabled, false);
  assert.match(r.reason, /no PR/i);
});

test('enableAutoMerge refuses a URL that is not a canonical PR url (no gh call)', async () => {
  for (const bad of ['https://example.com/foo', 'https://github.com/o/r/issues/3', 'not a url']) {
    const r = await enableAutoMerge(bad, '/tmp', { autoMerge: { method: 'merge' } });
    assert.equal(r.enabled, false, `should refuse ${bad}`);
  }
});
