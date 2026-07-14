'use strict';

// Locks the agentic-flywheel §4.2/§9 decision: /retro auto-invokes at /auto's
// two genuine session-terminal branches (Hard stop, Success) — never at the
// per-story Escalate or coverage-revert branches, which continue the session,
// and never on a --once intermediate link, which exits via a separate path
// (SECTION 10.1) before reaching SECTION 11 at all.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/auto invokes /retro at the Hard stop and Success stopping-criteria branches', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /Hard stop:[\s\S]*invoke `\/retro`/, 'Hard stop must invoke /retro before handing off');
  assert.match(auto, /Invoke `\/retro` once[\s\S]*unless `--no-retro`/, 'Success branch must invoke /retro');
});

test('/auto documents --no-retro and the --once non-interaction', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /--no-retro/, 'the escape hatch must be documented');
  assert.match(auto, /--once[\s\S]*never reaches (this section|these branches)/, 'must document that --once never auto-invokes /retro');
});

test('/retro stays silent (no review prompt) when Step 3 drafts zero new recommendations', () => {
  const skill = read('.claude/skills/retro/SKILL.md');
  assert.match(skill, /zero new recommendations[\s\S]*stay silent|stay silent[\s\S]*zero new recommendations/i);
});

test('the /retro guide is registered in harness-manifest.json and resolves', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const g = m.guides.find((x) => x.id === 'retro-auto-invoke');
  assert.ok(g, 'retro-auto-invoke guide must be registered');
  assert.strictEqual(g.kind, 'feedforward');
  assert.ok(fs.existsSync(path.join(ROOT, g.wired_at.split('#')[0])), 'wired_at must resolve');
});

test('harness-manifest.json itself remains internally valid (honesty invariant)', () => {
  const { validate } = require('../.claude/scripts/validate-harness-manifest.js');
  const manifest = JSON.parse(read('harness-manifest.json'));
  const { errors } = validate(manifest);
  assert.deepStrictEqual(errors, []);
});
