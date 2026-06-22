'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JiraTracker } = require('./jira');

const BASE_CONFIG = {
  jira: { baseUrl: 'https://acme.atlassian.net', email: 'ci-bot', apiToken: 'tok', projectKey: 'ENG' },
  tracker: { readyState: 'Ready for Agent', runningState: 'In Progress' }
};

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; }, async text() { return JSON.stringify(payload); } };
}

test('JiraTracker.listCandidates normalizes status, labels, ADF description and blockedBy', async () => {
  const calls = [];
  const tracker = new JiraTracker(BASE_CONFIG, async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      issues: [{
        id: '1001',
        key: 'ENG-1',
        fields: {
          summary: 'Build API',
          description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PRD body line' }] }] },
          status: { name: 'Ready for Agent' },
          labels: ['agent-ready', 'backend'],
          priority: { name: 'High' },
          issuelinks: [{
            type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: { id: '900', key: 'ENG-0', fields: { status: { name: 'Done' } } }
          }]
        }
      }]
    });
  });

  const issues = await tracker.listCandidates();

  assert.equal(issues.length, 1);
  const issue = issues[0];
  assert.equal(issue.id, '1001');
  assert.equal(issue.key, 'ENG-1');
  assert.equal(issue.title, 'Build API');
  assert.equal(issue.description, 'PRD body line');
  assert.equal(issue.state, 'Ready for Agent');
  assert.deepEqual(issue.labels, ['agent-ready', 'backend']);
  assert.equal(issue.priority, 'High');
  assert.equal(issue.url, 'https://acme.atlassian.net/browse/ENG-1');
  assert.deepEqual(issue.blockedBy, [{ id: '900', key: 'ENG-0', state: 'Done' }]);
  // JQL filters on both ready + running states.
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.jql, /Ready for Agent/);
  assert.match(body.jql, /In Progress/);
});

test('JiraTracker.moveIssue posts the transition whose target matches a fallback name', async () => {
  const calls = [];
  const tracker = new JiraTracker(BASE_CONFIG, async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') {
      return jsonResponse({ transitions: [
        { id: '31', name: 'Start', to: { name: 'In Progress' } },
        { id: '41', name: 'Review', to: { name: 'Human Review' } }
      ] });
    }
    return jsonResponse({}, 204);
  });

  await tracker.moveIssue('1001', 'In Review', ['Human Review']);

  const postBody = JSON.parse(calls[1].options.body);
  assert.equal(postBody.transition.id, '41');
});

test('JiraTracker.moveIssue throws with available targets when no transition matches', async () => {
  const tracker = new JiraTracker(BASE_CONFIG, async () =>
    jsonResponse({ transitions: [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] }));

  await assert.rejects(
    () => tracker.moveIssue('1001', 'Blocked', ['Canceled']),
    /Jira transition to state not found: Blocked .*available targets: In Progress/
  );
});

test('JiraTracker.addComment wraps the body in an ADF document', async () => {
  let captured = null;
  const tracker = new JiraTracker(BASE_CONFIG, async (url, options) => {
    captured = JSON.parse(options.body);
    return jsonResponse({}, 201);
  });

  await tracker.addComment('1001', 'line one\nline two');

  assert.equal(captured.body.type, 'doc');
  assert.equal(captured.body.content[0].content[0].text, 'line one');
  assert.equal(captured.body.content[1].content[0].text, 'line two');
});
