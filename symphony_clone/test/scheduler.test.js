'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isEligible } = require('../src/orchestrator/scheduler');

const config = {
  tracker: {
    readyState: 'Ready for Agent',
    readyLabel: 'agent-ready',
    terminalStates: ['Done', 'Canceled']
  }
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
