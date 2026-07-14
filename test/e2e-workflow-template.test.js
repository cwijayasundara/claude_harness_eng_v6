'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, '.claude', 'templates', 'github-workflows', 'e2e.yml');

test('e2e workflow template exists and runs the real Playwright suite on PRs', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(text, /pull_request/);
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /npx playwright install --with-deps chromium/);
  assert.match(text, /npx playwright test/);
  assert.match(text, /actions\/checkout@v5/);
  assert.match(text, /actions\/setup-node@v5/);
});

test('/test copies the e2e workflow into target projects alongside the playwright config', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'test', 'SKILL.md'), 'utf8');
  assert.match(skill, /github-workflows\/e2e\.yml/);
  assert.match(skill, /\.github\/workflows\/e2e\.yml/);
});

test('/build Phase 9.5 re-installs the Playwright browser before the suite (chained sessions)', () => {
  // Phase 4 progressive loading moved Phase 9.5's procedure into references/.
  const skill = readSkillCorpus('build');
  assert.match(skill, /npx playwright install --with-deps chromium/);
});
