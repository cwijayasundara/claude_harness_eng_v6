'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('pe-ic-memo SKILL.md has the right frontmatter and references the renderer', () => {
  const skill = read('.claude/skills/pe-ic-memo/SKILL.md');
  assert.match(skill, /^---\nname: pe-ic-memo\n/);
  assert.match(skill, /render_deck\.py/);
  assert.match(skill, /build_deck/);
});

test('pe-ic-memo SKILL.md documents the 9-section structure and the Firm Branding extension point', () => {
  const skill = read('.claude/skills/pe-ic-memo/SKILL.md');
  assert.match(skill, /Executive Summary/);
  assert.match(skill, /Recommendation/);
  assert.match(skill, /Firm Branding/);
  assert.match(skill, /ppt-template-creator/);
});

test('pe-ic-memo is NOT registered in scaffold-copy.js CORE_SKILLS or BROWNFIELD_SKILLS', () => {
  const scaffoldCopy = read('.claude/scripts/scaffold-copy.js');
  const coreMatch = scaffoldCopy.match(/const CORE_SKILLS = \[([\s\S]*?)\];/);
  assert.ok(coreMatch, 'could not find CORE_SKILLS array in scaffold-copy.js');
  assert.doesNotMatch(coreMatch[1], /pe-ic-memo/);
  const brownfieldMatch = scaffoldCopy.match(/const BROWNFIELD_SKILLS = \[([\s\S]*?)\];/);
  assert.ok(brownfieldMatch, 'could not find BROWNFIELD_SKILLS array in scaffold-copy.js');
  assert.doesNotMatch(brownfieldMatch[1], /pe-ic-memo/);
});

test('pe-ic-memo SKILL.md reads CONTEXT.md and reuses its terms verbatim', () => {
  const skill = read('.claude/skills/pe-ic-memo/SKILL.md');
  assert.match(skill, /Read `CONTEXT\.md`/);
  assert.match(skill, /verbatim/);
});
