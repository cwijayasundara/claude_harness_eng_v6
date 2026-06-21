'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { finishExecution, finishPlanning, resolveReviewOutcome } = require('./outcomes');

function fakeSched(overrides = {}) {
  const moved = [];
  return {
    moved,
    config: {
      tracker: {
        reviewState: 'Human Review', reviewStateCandidates: ['Human Review'],
        blockedState: 'Blocked', blockedStateCandidates: ['Blocked'],
        plannedState: 'Planned', plannedStateCandidates: ['Planned']
      },
      autoMerge: { enabled: false }
    },
    tracker: { addComment: async () => {}, moveIssue: async (id, s) => { moved.push(s); } },
    stateStore: null,
    logger: { info() {}, warn() {} },
    maybeCleanupWorkspace: async () => {},
    ...overrides
  };
}

const issue = { id: 'i1', key: 'ENG-1' };
const ws = { workspacePath: '/w', branchName: 'b' };

test('finishExecution: blocked result moves the issue to blocked', async () => {
  const sched = fakeSched();
  await finishExecution(sched, issue, { id: 'A' }, ws, { result: { status: 'blocked' } });
  assert.deepEqual(sched.moved, ['Blocked']);
});

test('finishPlanning: planned -> planned state; otherwise blocked', async () => {
  const ok = fakeSched();
  await finishPlanning(ok, issue, { id: 'ENG-1' }, ws, { result: { status: 'planned', groups_published: ['A'] } });
  assert.deepEqual(ok.moved, ['Planned']);
  const bad = fakeSched();
  await finishPlanning(bad, issue, { id: 'ENG-1' }, ws, { result: { status: 'blocked', blocker: 'no PRD' } });
  assert.deepEqual(bad.moved, ['Blocked']);
});

test('resolveReviewOutcome: auto-merge off -> human review; on+enabled -> done', async () => {
  const off = await resolveReviewOutcome(fakeSched(), issue, ws, 'https://github.com/o/r/pull/1');
  assert.equal(off.state, 'Human Review');
  const sched = fakeSched({
    config: { tracker: { reviewState: 'Human Review', reviewStateCandidates: ['Human Review'] }, autoMerge: { enabled: true, method: 'merge', doneState: 'Done', doneStateCandidates: ['Done'] } },
    enableAutoMerge: async () => ({ enabled: true })
  });
  const on = await resolveReviewOutcome(sched, issue, ws, 'https://github.com/o/r/pull/1');
  assert.equal(on.state, 'Done');
  assert.equal(on.runStatus, 'auto_merge');
});
