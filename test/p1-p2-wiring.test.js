'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shipsIn } = require('./helpers/pack-membership');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('story-sync and matrix-append ship in the planning pack', () => {
  assert.ok(shipsIn('story-sync', 'script').includes('core'));
  assert.ok(shipsIn('matrix-append', 'script').includes('core'));
  assert.ok(shipsIn('tracker-body', 'script').includes('core'));
  assert.ok(shipsIn('story-sync', 'lib').length > 0);
});

test('/change updates the bundle first then syncs after a refactor', () => {
  const change = readSkillCorpus('change');
  assert.match(change, /bundle-write\.js/);
  assert.match(change, /story-sync\.js/);
});

test('/implement and /auto run story-sync after code lands', () => {
  assert.match(readSkillCorpus('implement'), /story-sync\.js --write/);
  assert.match(readSkillCorpus('auto'), /story-sync\.js --write/);
});

test('/test appends sprint-scoped matrix rows when a sprint is active', () => {
  const testSkill = readSkillCorpus('test');
  assert.match(testSkill, /matrix-append\.js/);
  assert.match(testSkill, /sprint-N|sprint-\$\{|current-sprint/);
});

test('/tracker-publish renders bundle bodies and can publish to Azure DevOps', () => {
  const tracker = readSkillCorpus('tracker-publish');
  assert.match(tracker, /tracker-body\.js/);
  assert.match(tracker, /publish-to-ado\.js/);
  assert.match(tracker, /--provider azure|provider.*azure/i);
});

test('/sprint re-publishes tracker issues in place', () => {
  const sprint = readSkillCorpus('sprint');
  assert.match(sprint, /tracker-publish/);
  assert.match(sprint, /tracker-body\.js|granularity story/);
});

test('package.json exposes the new scripts', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.strictEqual(scripts['story-sync'], 'node .claude/scripts/story-sync.js');
  assert.strictEqual(scripts['matrix-append'], 'node .claude/scripts/matrix-append.js');
});
