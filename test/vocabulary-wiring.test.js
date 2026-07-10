'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

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
  const design = readSkillCorpus('design');
  assert.match(design, /Required glossary read/);
  assert.match(design, /vocabulary-check\.js/);
  assert.match(design, /vocabulary-consistency gate/);
});

test('REASONS Canvas Entities section requires CONTEXT.md term reuse', () => {
  const canvas = read('.claude/skills/design/references/reasons-canvas-template.md');
  assert.match(canvas, /CONTEXT\.md/);
});

test('/implement requires reading CONTEXT.md alongside learned rules', () => {
  const implement = read('.claude/skills/implement/SKILL.md');
  assert.match(implement, /CONTEXT\.md/);
});

test('generator.md lists CONTEXT.md as an input, reads it in Step 1, and passes it to teammates', () => {
  const generator = read('.claude/agents/generator.md');
  const contextMentions = generator.match(/CONTEXT\.md/g) || [];
  assert.ok(contextMentions.length >= 3, `expected >=3 CONTEXT.md mentions (Inputs, Step 1, teammate prompt), got ${contextMentions.length}`);
});

test('/brownfield Step 6 runs naming-clusters.js before writing CONTEXT.md', () => {
  const brownfield = read('.claude/skills/brownfield/SKILL.md');
  assert.match(brownfield, /naming-clusters\.js/);
  assert.match(brownfield, /naming-clusters\.md/);
  assert.doesNotMatch(brownfield, /Optional domain glossary, created only when meaningful domain terms are discovered/);
});
