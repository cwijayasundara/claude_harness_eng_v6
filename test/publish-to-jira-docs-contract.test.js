'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tracker-publish SKILL documents the --provider jira route to publish-to-jira.js', () => {
  const skill = read('.claude/skills/tracker-publish/SKILL.md');
  assert.match(skill, /publish-to-jira\.js/);
  assert.match(skill, /JIRA_EMAIL/);
  assert.match(skill, /JIRA_API_TOKEN/);
});

test('symphony README no longer calls Jira issue-creation a stub', () => {
  const readme = read('symphony_clone/README.md');
  assert.match(readme, /publish-to-jira/);
});
