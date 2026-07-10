'use strict';

// Static contract for the plan-only local-inspection lane (#1). Keeps `npm test`
// green without a live run, like the other e2e contracts.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/build documents --plan-only that stops after the architect phases', () => {
  const b = readSkillCorpus('build');
  assert.match(b, /--plan-only/);
  assert.match(b, /stop before Phase 3\.5|stop.*before.*code|then stop/i);
  assert.match(b, /No.*code generation|no code/i);
});

test('autonomous mode grounds on the PRD non-interactively (no headless interview)', () => {
  const b = readSkillCorpus('build');
  assert.match(b, /\/brd --prd/);
  assert.match(b, /not.*the interactive|cannot run headless|non-interactive/i);
});

test('the plan smoke runs scaffold + build --plan-only and summarizes specs/', () => {
  const smoke = read('test/e2e/harness-plan-only.test.js');
  assert.match(smoke, /require\(['"]\.\/helpers\/claude-runner['"]\)/);
  assert.match(smoke, /runClaude\('\/scaffold'/);
  assert.match(smoke, /runClaude\('\/build --autonomous --plan-only/);
  assert.match(smoke, /summarizeSpecs\(/);
  // must NOT generate code or raise a PR in plan-only
  assert.doesNotMatch(smoke, /gh pr create/);
  assert.doesNotMatch(smoke, /\/change/);
});

test('the sample PRD follows the canonical PRD format', () => {
  const prd = read('test/e2e/fixtures/sample-prd.md');
  assert.match(prd, /# PRD:/);
  assert.match(prd, /\bFR-1\b/);
  assert.match(prd, /\bNFR-1\b/);
  assert.match(prd, /## 5\. Out of Scope/);
  assert.match(prd, /## 6\. Acceptance/);
});

test('the specs-summary helper exposes summarize + format', () => {
  const h = read('test/e2e/helpers/specs-summary.js');
  assert.match(h, /function summarizeSpecs/);
  assert.match(h, /function formatSummary/);
});
