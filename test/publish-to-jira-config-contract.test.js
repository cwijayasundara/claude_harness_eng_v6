'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const tpl = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'templates', 'tracker-config.template.json'), 'utf8',
);

test('tracker-config template carries optional Jira fields and stays valid JSON', () => {
  assert.match(tpl, /base_url/);
  assert.match(tpl, /project_key/);
  assert.match(tpl, /issue_type/);
  const parsed = JSON.parse(tpl); // must remain valid JSON
  assert.ok(parsed.tracker, 'has a tracker block');
});
