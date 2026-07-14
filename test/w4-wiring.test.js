'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// W4 wires two gates into prose that must stay in lockstep with the scripts:
// per-diff coverage (coverage-diff.js) in /auto Gate 3, and the axe-core
// accessibility gate in the evaluator's Playwright layer.

test('/auto Gate 3 runs the per-diff coverage gate and records history', () => {
  // Phase 4 progressive loading moved Gate 3's procedure into references/.
  const auto = readSkillCorpus('auto');
  assert.match(auto, /coverage-diff\.js/, 'invokes the per-diff script');
  assert.match(auto, /coverage-history\.jsonl/, 'records the trend');
  assert.match(auto, /[Pp]er-diff coverage/, 'documents the per-diff gate');
});

test('coverage-diff.js exists and the script /auto names is real', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'scripts', 'coverage-diff.js')));
});

test('the evaluator runs an axe-core accessibility gate', () => {
  const skill = read('.claude', 'skills', 'evaluate', 'SKILL.md');
  assert.match(skill, /accessibility_checks/, 'reads the contract block');
  assert.match(skill, /axe/i, 'runs axe-core');
  assert.match(skill, /"accessibility"/, 'adds the accessibility failure_layer');
});

test('the evaluator agent has the browser_evaluate tool and the a11y rule', () => {
  const agent = read('.claude', 'agents', 'evaluator.md');
  assert.match(agent, /browser_evaluate/, 'can run axe via browser_evaluate');
  assert.match(agent, /accessibility_checks/, 'documents the a11y gate');
});

test('the canonical Playwright reference documents the axe pattern', () => {
  const pw = read('.claude', 'skills', 'evaluate', 'references', 'playwright-patterns.md');
  assert.match(pw, /axe/i, 'has an axe-core section');
  assert.match(pw, /block_impacts/, 'ties violations to the contract block_impacts');
});
