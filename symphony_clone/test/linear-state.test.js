'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LinearTracker } = require('../src/tracker/linear');

test('LinearTracker resolves state with configured fallback names', async () => {
  const calls = [];
  const tracker = new LinearTracker({
    linear: { apiUrl: 'https://linear.test/graphql', apiKey: 'lin_test', projectSlug: 'proj' },
    tracker: {}
  }, async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return {
      ok: true,
      async json() {
        if (calls.length === 1) {
          return { data: { workflowStates: { nodes: [
            { id: 'state-review', name: 'In Review' },
            { id: 'state-todo', name: 'Todo' }
          ] } } };
        }
        return { data: { issueUpdate: { success: true } } };
      }
    };
  });

  await tracker.moveIssue('issue-1', 'Human Review', ['In Review', 'Review']);

  assert.equal(calls[1].variables.stateId, 'state-review');
});
test('LinearTracker reports available states when no configured state matches', async () => {
  const tracker = new LinearTracker({
    linear: { apiUrl: 'https://linear.test/graphql', apiKey: 'lin_test', projectSlug: 'proj' },
    tracker: {}
  }, async () => ({
    ok: true,
    async json() {
      return { data: { workflowStates: { nodes: [{ id: 'state-todo', name: 'Todo' }] } } };
    }
  }));

  await assert.rejects(
    () => tracker.findStateId('Blocked', ['Canceled']),
    /Linear workflow state not found: Blocked \(tried: Blocked, Canceled; available: Todo\)/
  );
});
