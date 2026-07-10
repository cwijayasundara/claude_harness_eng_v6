'use strict';

// Static contract for the local auto / semi-auto live runners (modes 1 & 2).
// Runs in the fast suite so it pins the harness shape without a live `claude -p`.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('auto-run harness: full-auto (zero gates) -> verify -> alter via code-map', () => {
  const h = read('test/e2e/harness-auto-run.test.js');
  assert.match(h, /require\(['"]\.\/helpers\/claude-runner['"]\)/);
  assert.match(h, /\/scaffold --yes/);
  assert.match(h, /runClaude\([`'"]\/build --auto /);
  assert.match(h, /runProjectSuite\(/); // generated app's own suite is the oracle
  assert.match(h, /alterAndVerify\(/); // post-build alteration exercising code-map/brownfield
  assert.doesNotMatch(h, /runClaude\([`'"]\/build --autonomous/); // full-auto, not semi
});

test('semi-auto-run harness: /build --autonomous build -> alter via code-map', () => {
  const h = read('test/e2e/harness-semi-auto-run.test.js');
  assert.match(h, /\/scaffold --yes/);
  assert.match(h, /runClaude\([`'"]\/build --autonomous /);
  assert.match(h, /runProjectSuite\(/); // builds and verifies (headless --autonomous proceeds; the pause is human-only)
  assert.match(h, /alterAndVerify\(/); // then alters, exercising code-map/brownfield
});

test('alter-and-verify helper maps the codebase (/code-map) then changes it (/change)', () => {
  const a = read('test/e2e/helpers/alter-and-verify.js');
  assert.match(a, /\/code-map/); // deterministic graph + wiki, not the slow /brownfield essays
  assert.match(a, /\/change/);
  assert.match(a, /code-graph\.json/);
  assert.match(a, /runProjectSuite/);
});

test('the counter PRD fixture follows the canonical PRD format', () => {
  const prd = read('test/e2e/fixtures/counter-prd.md');
  assert.match(prd, /# PRD:/);
  assert.match(prd, /\bFR-1\b/);
  assert.match(prd, /\bNFR-1\b/);
  assert.match(prd, /## 5\. Out of Scope/);
  assert.match(prd, /## 6\. Acceptance/);
});
