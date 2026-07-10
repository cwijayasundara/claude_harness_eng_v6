'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/pr-respond skill exists with the poller, bounds, and safety rails wired', () => {
  const skill = read('.claude/skills/pr-respond/SKILL.md');
  assert.match(skill, /pr-poll\.js/);
  assert.match(skill, /--record-check|--record-comment/);
  assert.match(skill, /--max-cycles/);
  assert.match(skill, /--watch/);
  assert.match(skill, /budget-state\.js/);
  assert.match(skill, /receiving-code-review/);
  assert.match(skill, /systematic-debugging/);
  assert.match(skill, /[Nn]ever force-push/);
  assert.match(skill, /untrusted/);
  assert.match(skill, /Self-Healing|self-healing/);
  assert.match(skill, /record.*reply|reply.*id/i);
  assert.match(skill, /log output|--log-failed/);
  assert.match(skill, /2\.37/);
});

test('/build and /feature expose the opt-in --respond flag', () => {
  assert.match(readSkillCorpus('build'), /--respond/);
  assert.match(read('.claude/skills/feature/SKILL.md'), /--respond/);
});

test('pr-respond is registered in the harness manifest and HARNESS.md', () => {
  const manifest = JSON.parse(read('harness-manifest.json'));
  const all = JSON.stringify(manifest);
  assert.match(all, /pr-respond/);
  assert.match(read('HARNESS.md'), /pr-respond/);
});
