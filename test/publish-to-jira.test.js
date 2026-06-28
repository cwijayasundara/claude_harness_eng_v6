'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const {
  publishGroups, textToAdf, basicAuth, looksAlreadyPublished, pickTransition,
} = require(path.join(__dirname, '..', '.claude/skills/tracker-publish/scripts/publish-to-jira.js'));

const CONFIG = { projectKey: 'PROJ', issueType: 'Task', readyState: 'Ready for Agent', baseUrl: 'JIRA_BASE' };

function recordingRequest(transitions = [{ id: '31', name: 'Ready for Agent' }]) {
  const calls = [];
  const request = async (method, p, body) => {
    calls.push({ method, p, body });
    if (method === 'POST' && p === '/rest/api/3/issue') return { id: '10001', key: 'PROJ-1' };
    if (method === 'GET' && /\/transitions$/.test(p)) return { transitions };
    return {};
  };
  return { calls, request };
}

test('textToAdf produces a doc with one paragraph per line (empty line → empty content)', () => {
  const adf = textToAdf('hello\n\nworld');
  assert.strictEqual(adf.type, 'doc');
  assert.strictEqual(adf.version, 1);
  assert.deepStrictEqual(adf.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] });
  assert.deepStrictEqual(adf.content[1], { type: 'paragraph', content: [] });
});

test('basicAuth is base64 of email:token', () => {
  assert.strictEqual(basicAuth('user@test.local', 'testtoken'), Buffer.from('user@test.local:testtoken').toString('base64'));
});

test('looksAlreadyPublished: real key true, pending/local false, none false', () => {
  assert.strictEqual(looksAlreadyPublished({ tracker_key: 'PROJ-9' }), true);
  assert.strictEqual(looksAlreadyPublished({ tracker_key: 'PROJ-LOCAL-1' }), false);
  assert.strictEqual(looksAlreadyPublished({}), false);
});

test('pickTransition matches by name or target name, case-insensitive', () => {
  const ts = [{ id: '11', name: 'Start' }, { id: '31', to: { name: 'Ready For Agent' } }];
  assert.strictEqual(pickTransition(ts, 'ready for agent').id, '31');
  assert.strictEqual(pickTransition(ts, 'nope'), null);
});

test('publishGroups creates an issue then transitions it to ready', async () => {
  const map = { groups: { A: { title: 'Group A', labels: ['x'], stories: ['E1-S1'] } }, stories: { 'E1-S1': { group: 'A' } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'body text' });

  const create = calls.find((c) => c.method === 'POST' && c.p === '/rest/api/3/issue');
  assert.deepStrictEqual(create.body.fields.project, { key: 'PROJ' });
  assert.strictEqual(create.body.fields.summary, 'Group A');
  assert.strictEqual(create.body.fields.issuetype.name, 'Task');
  assert.deepStrictEqual(create.body.fields.labels, ['x']);
  assert.strictEqual(create.body.fields.description.type, 'doc');

  assert.ok(calls.find((c) => c.method === 'GET' && /\/transitions$/.test(c.p)));
  const move = calls.find((c) => c.method === 'POST' && /\/transitions$/.test(c.p));
  assert.deepStrictEqual(move.body, { transition: { id: '31' } });

  assert.strictEqual(map.groups.A.tracker_key, 'PROJ-1');
  assert.strictEqual(map.groups.A.url, 'JIRA_BASE/browse/PROJ-1');
  assert.strictEqual(map.stories['E1-S1'].tracker_key, 'PROJ-1');
  assert.strictEqual(res.created.length, 1);
  assert.strictEqual(res.warnings.length, 0);
});

test('publishGroups warns (no throw) when no transition matches the ready state', async () => {
  const map = { groups: { A: { title: 'A', stories: [] } } };
  const { calls, request } = recordingRequest([{ id: '11', name: 'Start' }]);
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'b' });
  assert.strictEqual(res.created.length, 1);
  assert.strictEqual(res.warnings.length, 1);
  assert.match(res.warnings[0], /no transition/i);
  assert.ok(!calls.find((c) => c.method === 'POST' && /\/transitions$/.test(c.p)), 'no transition POST');
});

test('publishGroups skips an already-published group (no create)', async () => {
  const map = { groups: { A: { title: 'A', stories: [], tracker_key: 'PROJ-7' } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'b' });
  assert.strictEqual(res.skipped.length, 1);
  assert.strictEqual(res.created.length, 0);
  assert.strictEqual(calls.length, 0);
});

test('publishGroups dry-run makes no requests', async () => {
  const map = { groups: { A: { title: 'A', stories: [] } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'b', dryRun: true });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(res.created[0].dryRun, true);
  assert.strictEqual(map.groups.A.tracker_key, undefined);
});
