'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

test('/brd seeds CONTEXT.md from domain_concepts', () => {
  const brd = read('.claude/skills/brd/SKILL.md');
  assert.match(brd, /Seed the domain glossary/);
  assert.match(brd, /CONTEXT\.md/);
  assert.match(brd, /domain_concepts/);
});
