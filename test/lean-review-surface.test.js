'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const surface = fs.readFileSync(
  path.join(ROOT, '.claude/skills/plan-review-loop/references/lean-review-surface.md'),
  'utf8',
);

test('lean review surface names the four phase pairs', () => {
  assert.match(surface, /brd\.md/);
  assert.match(surface, /brd-requirements\.json/);
  assert.match(surface, /program-design\.md/);
  assert.match(surface, /verification-matrix\.json/);
  assert.match(surface, /vertical slices/i);
  assert.match(surface, /`--eval`/);
});

test('program-design template ships', () => {
  const tpl = fs.readFileSync(
    path.join(ROOT, '.claude/templates/program-design.template.md'),
    'utf8',
  );
  assert.match(tpl, /## Types/);
  assert.match(tpl, /## Signatures/);
  assert.match(tpl, /## Call stack/);
  assert.match(tpl, /## File tree/);
});

test('/brd /spec /design /test cite the lean surface and skip phase-eval by default', () => {
  for (const phase of ['brd', 'spec', 'design', 'test']) {
    const corpus = readSkillCorpus(phase);
    assert.match(corpus, /lean-review-surface/, `/${phase} must cite the lean review surface`);
    assert.match(corpus, /`--eval`/, `/${phase} must treat phase-eval as opt-in`);
  }
});

test('/design-render writes program-design and skips mockups when there is no UI', () => {
  const corpus = readSkillCorpus('design-render');
  assert.match(corpus, /program-design\.md/);
  assert.match(corpus, /program-design\.template\.md/);
  assert.match(corpus, /UI stories only|no ready story has `layer: UI`/i);
});

test('/spec-render forbids the layer ladder as a decomposition', () => {
  const corpus = readSkillCorpus('spec-render');
  assert.match(corpus, /tracer bullet/);
  assert.match(corpus, /layer ladder/i);
});

test('/auto requires program-design.md before coding', () => {
  assert.match(readSkillCorpus('auto'), /program-design\.md/);
});

test('/test --plan-only does not write Playwright or AT source', () => {
  const test = readSkillCorpus('test');
  assert.match(test, /Do not write Playwright/);
  assert.match(test, /Do not[\s\S]{0,40}write AT source/i);
});
