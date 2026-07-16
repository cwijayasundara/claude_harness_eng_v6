'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('/gate regression step invokes replay mode', () => {
  assert.match(read('.claude/skills/gate/SKILL.md'), /--replay/);
});

test('/auto boots the app under HARNESS_TEST_REPLAY for pre-merge regression', () => {
  assert.match(read('.claude/skills/auto/SKILL.md'), /HARNESS_TEST_REPLAY/);
});
