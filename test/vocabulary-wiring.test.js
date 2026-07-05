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

test('/spec requires reading CONTEXT.md and reusing its terms before writing stories', () => {
  const spec = read('.claude/skills/spec/SKILL.md');
  assert.match(spec, /Read the domain glossary/);
  assert.match(spec, /CONTEXT\.md/);
});

test('/design requires a glossary read before naming entities, and runs the vocabulary-check gate', () => {
  const design = read('.claude/skills/design/SKILL.md');
  assert.match(design, /Required glossary read/);
  assert.match(design, /vocabulary-check\.js/);
  assert.match(design, /vocabulary-consistency gate/);
});

test('REASONS Canvas Entities section requires CONTEXT.md term reuse', () => {
  const canvas = read('.claude/skills/design/references/reasons-canvas-template.md');
  assert.match(canvas, /CONTEXT\.md/);
});
