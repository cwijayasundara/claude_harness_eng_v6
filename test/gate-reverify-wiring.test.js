'use strict';

// Locks Item 1 of the 2026-07-09 Devin/Anthropic/Thoughtworks parity-hardening
// pass (docs/superpowers/specs/2026-07-09-devin-parity-hardening-design.md,
// §3): when /gate's security trigger fires, evaluator and security-reviewer
// each get 2 additional independent instances (3 total per axis), majority
// voted, fail-safe to BLOCK/FAIL on a non-clean vote. Scoped to /gate only,
// not /auto's per-group Gate 7.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/gate spawns 3 independent instances of evaluator and security-reviewer on the security trigger', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /2 additional independent instances/, 'must describe the additional spawns');
  assert.match(skill, /fresh context per instance/, 'instances must not share conversation context');
  assert.match(skill, /majority vote \(2-of-3\)/, 'must majority-vote each axis');
});

test('/gate fails safe to BLOCK/FAIL on a non-clean vote', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(
    skill,
    /fail safe to the stricter outcome \(BLOCK\/FAIL\)/,
    'must fail safe, not escalate to human (per spec\'s rejected-alternative decision)'
  );
});

test('/gate writes reverify-votes.json without changing existing verdict-file consumers', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /reverify-votes\.json/, 'must document the new audit-trail file');
  assert.match(skill, /written exactly as before/, 'existing verdict files must stay unchanged in shape/source');
  assert.match(
    skill,
    /`specs\/reviews\/reverify-votes\.json` — 3-instance majority-vote audit trail; only when a security trigger fired/,
    'Output Files section must list the new file'
  );
});

test('re-verification is scoped to /gate only, not /auto Gate 7', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(
    skill,
    /`\/auto`'s per-group Gate 7 keeps its existing single-pass security review unchanged/,
    'must explicitly scope the change away from /auto\'s recurring per-group gate'
  );
});
