'use strict';

// Phase 4: entry SKILL.md files that use progressive loading stay small.
// Procedure lives in references/; the entry file is an orchestrator index.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { skillEntryLineCount, readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');

// Soft budgets (lines). Raise only with justification in the PR.
const ENTRY_BUDGETS = {
  auto: 80, // progressive index + gate name anchors
  design: 80,
};

for (const [skill, budget] of Object.entries(ENTRY_BUDGETS)) {
  test(`${skill} SKILL.md is under the progressive-loading budget`, () => {
    const n = skillEntryLineCount(skill);
    assert.ok(
      n <= budget,
      `${skill}/SKILL.md is ${n} lines (budget ${budget}); move procedure to references/`
    );
  });
}

test('auto has references for progressive sections', () => {
  const refs = path.join(ROOT, '.claude', 'skills', 'auto', 'references');
  assert.ok(fs.existsSync(refs));
  const files = fs.readdirSync(refs).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 10, `expected many section files, got ${files.length}`);
});

test('design has mode references for progressive loading', () => {
  const refs = path.join(ROOT, '.claude', 'skills', 'design', 'references');
  assert.ok(fs.existsSync(refs));
  const modes = fs.readdirSync(refs).filter((f) => f.startsWith('mode-') && f.endsWith('.md'));
  assert.ok(modes.length >= 8, `expected mode-*.md files, got ${modes.length}`);
});

test('auto corpus still documents load-bearing gates', () => {
  const corpus = readSkillCorpus('auto');
  for (const needle of [
    'cycle-gate.js',
    'coupling-gate.js',
    'mutation-gate',
    'regression-gate',
    'wave-plan.js',
  ]) {
    assert.ok(corpus.includes(needle) || new RegExp(needle, 'i').test(corpus),
      `auto corpus missing ${needle}`);
  }
});

test('design corpus still documents load-bearing design gates', () => {
  const corpus = readSkillCorpus('design');
  for (const needle of [
    'trace-check.js',
    'validate-canvas.js',
    'vocabulary-check.js',
    'modularity-pack.js',
    'record-modularity-review.js',
  ]) {
    assert.ok(corpus.includes(needle), `design corpus missing ${needle}`);
  }
});
