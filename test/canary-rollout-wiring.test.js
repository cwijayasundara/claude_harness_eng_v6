'use strict';

// Gap G32 (canary-first mechanical rollout). Prompt-level guide only — no
// computational sensor — so this locks the instruction text into the two
// skills it governs, the same pattern test/gate-reverify-wiring.test.js uses
// for /gate's Devin-parity re-verification pass (a skill-prompt-only feature
// with no runtime script to unit-test directly).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/refactor canaries a large mechanical fix before applying it across all affected files', () => {
  const skill = read('.claude/skills/refactor/SKILL.md');
  assert.match(skill, /[Cc]anary/, 'must describe a canary/trial step');
  assert.match(skill, /more than ~?10 files/, 'must state a concrete file-count trigger threshold');
});

test('upgrading-dependencies canaries a large mechanical call-site rewrite before extending it to the full usage surface', () => {
  const skill = read('.claude/skills/upgrading-dependencies/SKILL.md');
  assert.match(skill, /[Cc]anary/, 'must describe a canary/trial step');
  assert.match(skill, /more than ~?10 files/, 'must state a concrete file-count trigger threshold');
});
