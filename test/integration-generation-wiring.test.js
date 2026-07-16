'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('/test describes an integration-generation step binding the boundary doubles', () => {
  const s = read('.claude/skills/test/SKILL.md');
  assert.match(s, /tests\/integration\//);
  assert.match(s, /HARNESS_TEST_REPLAY/);
  assert.match(s, /boundary-doubles/);
});

test('writing-acceptance-tests-first references the shipped AT template', () => {
  assert.match(read('.claude/skills/writing-acceptance-tests-first/SKILL.md'), /at-template\.py|templates\/at-template/);
});
