'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AzureDevOpsTracker } = require('./azure');

const BASE_CONFIG = {
  azure: { orgUrl: 'https://dev.azure.com/myorg', project: 'MyProj', pat: 'pat', baseUrl: 'https://dev.azure.com/myorg/MyProj' },
  tracker: { readyState: 'Ready for Agent', runningState: 'In Progress' }
};

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; }, async text() { return JSON.stringify(payload); } };
}

test('AzureDevOpsTracker.listCandidates runs WIQL, batches work items, and resolves blocker state', async () => {
  const calls = [];
  const tracker = new AzureDevOpsTracker(BASE_CONFIG, async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/wiql')) {
      return jsonResponse({ workItems: [{ id: 1 }, { id: 2 }] });
    }
    if (url.includes('$expand=relations')) {
      return jsonResponse({ value: [
        {
          id: 1,
          fields: {
            'System.Title': 'Cluster A',
            'System.State': 'Ready for Agent',
            'System.Tags': 'agent-ready; backend',
            'Microsoft.VSTS.Common.Priority': 2,
            'System.Description': '<p>PRD line</p>'
          },
          relations: [{ rel: 'System.LinkTypes.Dependency-Reverse', url: 'https://dev.azure.com/myorg/_apis/wit/workItems/9' }]
        },
        { id: 2, fields: { 'System.Title': 'Cluster B', 'System.State': 'In Progress', 'System.Tags': 'agent-ready' }, relations: [] }
      ] });
    }
    // Blocker state resolution batch.
    return jsonResponse({ value: [{ id: 9, fields: { 'System.State': 'Done' } }] });
  });

  const issues = await tracker.listCandidates();

  assert.equal(issues.length, 2);
  const first = issues[0];
  assert.equal(first.id, 1);
  assert.equal(first.key, '1');
  assert.equal(first.title, 'Cluster A');
  assert.equal(first.description, 'PRD line');
  assert.equal(first.state, 'Ready for Agent');
  assert.deepEqual(first.labels, ['agent-ready', 'backend']);
  assert.match(first.url, /\/_workitems\/edit\/1$/);
  assert.deepEqual(first.blockedBy, [{ id: 9, key: '9', state: 'Done' }]);
  assert.deepEqual(issues[1].blockedBy, []);
});

test('AzureDevOpsTracker.listCandidates short-circuits when WIQL returns no ids', async () => {
  let count = 0;
  const tracker = new AzureDevOpsTracker(BASE_CONFIG, async () => {
    count += 1;
    return jsonResponse({ workItems: [] });
  });

  const issues = await tracker.listCandidates();

  assert.deepEqual(issues, []);
  assert.equal(count, 1);
});

test('AzureDevOpsTracker.moveIssue falls through to the next candidate state on failure', async () => {
  const patched = [];
  const tracker = new AzureDevOpsTracker(BASE_CONFIG, async (url, options) => {
    const body = JSON.parse(options.body);
    patched.push(body[0].value);
    if (body[0].value === 'BadState') return jsonResponse({ message: 'invalid' }, 400);
    return jsonResponse({ id: 1 });
  });

  await tracker.moveIssue(1, 'BadState', ['Done']);

  assert.deepEqual(patched, ['BadState', 'Done']);
});

test('AzureDevOpsTracker.moveIssue throws when no candidate state applies', async () => {
  const tracker = new AzureDevOpsTracker(BASE_CONFIG, async () => jsonResponse({ message: 'invalid' }, 400));

  await assert.rejects(
    () => tracker.moveIssue(1, 'Nope', ['AlsoNope']),
    /Azure DevOps could not set state for work item 1 \(tried: Nope, AlsoNope\)/
  );
});

test('AzureDevOpsTracker.addComment posts plain text to the comments endpoint', async () => {
  let captured = null;
  const tracker = new AzureDevOpsTracker(BASE_CONFIG, async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return jsonResponse({ id: 5 });
  });

  await tracker.addComment(1, 'proof comment');

  assert.match(captured.url, /\/workItems\/1\/comments/);
  assert.equal(captured.body.text, 'proof comment');
});
