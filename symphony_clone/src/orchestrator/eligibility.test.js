'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, issueKind, isEligible, isStuck } = require('./eligibility');

const cfg = {
  tracker: {
    readyState: 'Ready for Agent', runningState: 'In Progress', readyLabel: 'agent-ready',
    planLabel: 'agent-plan', terminalStates: ['Done', 'Canceled']
  }
};

test('normalize lowercases and trims', () => {
  assert.equal(normalize('  Ready For Agent '), 'ready for agent');
  assert.equal(normalize(null), '');
});

test('issueKind: plan label -> plan, ready label -> execute, neither -> null', () => {
  assert.equal(issueKind({ labels: ['agent-plan'] }, cfg), 'plan');
  assert.equal(issueKind({ labels: ['agent-ready'] }, cfg), 'execute');
  assert.equal(issueKind({ labels: ['x'] }, cfg), null);
});

test('isEligible needs ready state, a known label, and terminal blockers', () => {
  assert.equal(isEligible({ state: 'Ready for Agent', labels: ['agent-ready'], blockedBy: [{ state: 'Done' }] }, cfg), true);
  assert.equal(isEligible({ state: 'Ready for Agent', labels: ['agent-plan'], blockedBy: [] }, cfg), true);
  assert.equal(isEligible({ state: 'Ready for Agent', labels: ['agent-ready'], blockedBy: [{ state: 'In Progress' }] }, cfg), false);
  assert.equal(isEligible({ state: 'Ready for Agent', labels: ['nope'], blockedBy: [] }, cfg), false);
});

test('isStuck: in running state but not claimed by this process', () => {
  assert.equal(isStuck({ id: 'i1', state: 'In Progress' }, new Set(), cfg), true);
  assert.equal(isStuck({ id: 'i1', state: 'In Progress' }, new Set(['i1']), cfg), false);
  assert.equal(isStuck({ id: 'i1', state: 'Ready for Agent' }, new Set(), cfg), false);
});
