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
  assert.match(surface, /reasons-canvas\.md/);
  assert.match(surface, /Generation Contract/);
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
  assert.match(test, /Do not write AT source/i);
});

test('/auto skips contract negotiation when the /test freeze exists', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /contract-freeze\.js/);
  assert.match(auto, /Skip Step 2 and Step 3/);
  const generator = fs.readFileSync(path.join(ROOT, '.claude/agents/generator.md'), 'utf8');
  assert.match(generator, /contract-freeze\.json/);
  assert.doesNotMatch(generator, /Negotiates sprint contracts with evaluator/);
});

test('/test human gate reviews GWT scenarios and proposed evaluator checks', () => {
  const test = readSkillCorpus('test');
  assert.match(test, /Given\/When\/Then/);
  assert.match(test, /proposed evaluator checks|Proposed sprint-contract checks/);
  assert.match(test, /sprint-contracts\/\*\.json/);
  assert.match(test, /contract-freeze\.js/);
  assert.match(surface, /Given\/When\/Then scenarios/);
  assert.match(surface, /proposed evaluator checks/);
  assert.match(test, /Do not write Cucumber or `\.feature` files/);
});

test('phase-eval is flag-only — auth is not an implicit trigger', () => {
  const surface = fs.readFileSync(
    path.join(ROOT, '.claude/skills/plan-review-loop/references/lean-review-surface.md'),
    'utf8',
  );
  assert.match(surface, /unless the invocation includes `--eval`/);
  assert.doesNotMatch(
    surface,
    /unless the invocation includes `--eval`\s+or the artifact introduces/,
    'auth/tenant/migration must not auto-enable artefact eval',
  );
  for (const phase of ['spec', 'design', 'test']) {
    const corpus = readSkillCorpus(phase);
    assert.match(corpus, /Skip unless `--eval`/, `/${phase} eval must be flag-only`);
    assert.doesNotMatch(
      corpus,
      /Skip unless `--eval` or /,
      `/${phase} must not treat a security boundary as implicit --eval`,
    );
  }
});

test('/test --plan-only does not spawn a nested generator or load evaluate', () => {
  const plan = fs.readFileSync(
    path.join(ROOT, '.claude/skills/test/references/test-plan.md'),
    'utf8',
  );
  assert.doesNotMatch(plan, /evaluate\/SKILL/);
  assert.doesNotMatch(plan, /Spawn the `generator`/);
  assert.match(plan, /Do not write `test-cases\.md`/);
  assert.match(plan, /Do not load the evaluate skill/);
});
