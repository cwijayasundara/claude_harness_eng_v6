'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildSingleStoryMap } = require(
  path.join(__dirname, '..', '.claude/skills/tracker-publish/scripts/single-story-map.js')
);

test('builds one group keyed by storyId in the publisher-consumed shape', () => {
  const m = buildSingleStoryMap({
    storyId: 'F-001',
    title: 'Add confidence scores to extraction',
    acBody: '- AC1: ...',
    labels: ['feature'],
    config: { project_slug: 'demo', ready_state: 'Ready for Agent' }
  });
  assert.equal(m.granularity, 'single');
  assert.equal(m.provider, 'linear');
  assert.deepEqual(Object.keys(m.groups), ['F-001']);
  const g = m.groups['F-001'];
  assert.equal(g.body_file, '.claude/state/tracker-runs/group-F-001.md');
  assert.deepEqual(g.stories, ['F-001']);
  assert.equal(g.tracker_key, null); // so looksAlreadyPublished() returns false → it publishes
  assert.ok(g.labels.includes('agent-ready'));
  assert.ok(g.labels.includes('feature'));
  assert.deepEqual(m.stories['F-001'], { group: 'F-001', tracker_key: null });
  assert.equal(m.config_snapshot.project_slug, 'demo');
});

test('throws when storyId or title is missing', () => {
  assert.throws(() => buildSingleStoryMap({ title: 'x' }), /storyId required/);
  assert.throws(() => buildSingleStoryMap({ storyId: 'F-002' }), /title required/);
});

test('deduplicates labels and always includes agent-ready', () => {
  const m = buildSingleStoryMap({ storyId: 'F-003', title: 't', labels: ['agent-ready', 'agent-ready', 'x'] });
  const labels = m.groups['F-003'].labels;
  assert.equal(labels.filter((l) => l === 'agent-ready').length, 1);
  assert.deepEqual(labels.sort(), ['agent-ready', 'x']);
});
