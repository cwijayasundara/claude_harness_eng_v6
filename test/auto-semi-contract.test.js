'use strict';

// Static contract for the local auto / semi-auto live runners (modes 1 & 2).
// Runs in the fast suite so it pins the harness shape without a live `claude -p`.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('auto-run harness drives full-auto (/build --auto, zero gates) and checks the suite', () => {
  const h = read('test/e2e/harness-auto-run.test.js');
  assert.match(h, /require\(['"]\.\/helpers\/claude-runner['"]\)/);
  assert.match(h, /runClaude\('\/scaffold'/);
  assert.match(h, /runClaude\('\/build --auto /);
  assert.match(h, /runProjectSuite\(/); // generated app's own suite is the oracle
  assert.doesNotMatch(h, /runClaude\([`'"]\/build --autonomous/); // full-auto, not semi
});

test('semi-auto-run harness drives /build --autonomous and asserts it pauses at the gate', () => {
  const h = read('test/e2e/harness-semi-auto-run.test.js');
  assert.match(h, /runClaude\('\/build --autonomous /);
  assert.match(h, /\/approv\/i/); // asserts the approval gate is reached
  assert.doesNotMatch(h, /runProjectSuite/); // semi-auto must NOT silently build a passing app
});

test('the counter PRD fixture follows the canonical PRD format', () => {
  const prd = read('test/e2e/fixtures/counter-prd.md');
  assert.match(prd, /# PRD:/);
  assert.match(prd, /\bFR-1\b/);
  assert.match(prd, /\bNFR-1\b/);
  assert.match(prd, /## 5\. Out of Scope/);
  assert.match(prd, /## 6\. Acceptance/);
});
