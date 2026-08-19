'use strict';

const assert = require('assert');
const { test } = require('node:test');
const path = require('path');

const {
  publishGroups, looksAlreadyPublished, markdownToHtml, createPatch,
} = require(path.join(__dirname, '..', '.claude/skills/tracker-publish/scripts/publish-to-ado.js'));

const CONFIG = { orgUrl: 'https://dev.azure.com/org', project: 'Eng', workItemType: 'Task' };

function recordingRequest() {
  const calls = [];
  const request = async (method, p, body) => {
    calls.push({ method, p, body });
    if (method === 'POST') return { id: 42 };
    return {};
  };
  return { calls, request };
}

test('looksAlreadyPublished requires a numeric ADO id', () => {
  assert.strictEqual(looksAlreadyPublished({ tracker_key: '42' }), true);
  assert.strictEqual(looksAlreadyPublished({ tracker_key: 'ENG-1' }), false);
  assert.strictEqual(looksAlreadyPublished({ tracker_key: 'pending-remote-publish' }), false);
});

test('markdownToHtml wraps each line', () => {
  assert.match(markdownToHtml('hello\nworld'), /<p>hello<\/p><p>world<\/p>/);
});

test('createPatch sets title, description, and tags', () => {
  const ops = createPatch('T', '<p>b</p>', ['harness-group', 'group-A']);
  assert.strictEqual(ops[0].path, '/fields/System.Title');
  assert.strictEqual(ops[2].value, 'harness-group; group-A');
});

test('publishGroups creates a new work item', async () => {
  const map = { groups: { A: { title: 'Group A', stories: ['E1-S1'], labels: ['g'] } }, stories: { 'E1-S1': { group: 'A' } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'body' });
  assert.strictEqual(res.created.length, 1);
  assert.strictEqual(res.created[0].key, '42');
  assert.ok(calls[0].p.includes('/_apis/wit/workitems/$Task'));
  assert.strictEqual(map.groups.A.tracker_key, '42');
});

test('publishGroups updates an existing numeric work item', async () => {
  const map = { groups: { A: { title: 'Group A', tracker_key: '7', stories: [] } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'updated body' });
  assert.strictEqual(res.updated.length, 1);
  assert.strictEqual(res.created.length, 0);
  assert.strictEqual(calls[0].method, 'PATCH');
  assert.match(calls[0].p, /workitems\/7/);
});
