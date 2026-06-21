'use strict';

// Static contract for the self-healing smoke (test/e2e/harness-selfheal-smoke.test.js).
// Like real-workflow-e2e-contract.test.js, this runs in the main (cheap) suite and
// asserts the live smoke wires the full lifecycle — scaffold, build, browser
// verify, modify-existing-code, regression, and a bounded fix loop — without
// paying for an actual live `claude -p` run.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SMOKE = path.join(ROOT, 'test', 'e2e', 'harness-selfheal-smoke.test.js');
const RUNTIME = path.join(ROOT, 'test', 'e2e', 'helpers', 'app-runtime.js');

function read(p) { return fs.readFileSync(p, 'utf8'); }

test('smoke harness exists and reuses the shared claude-runner (no reinvented runner)', () => {
  assert.ok(fs.existsSync(SMOKE), 'test/e2e/harness-selfheal-smoke.test.js must exist');
  const smoke = read(SMOKE);
  assert.match(smoke, /require\(['"]\.\/helpers\/claude-runner['"]\)/);
  assert.match(smoke, /runClaude\(/);
});

test('smoke runs the full lifecycle: scaffold -> lite build -> modify via /change', () => {
  const smoke = read(SMOKE);
  assert.match(smoke, /runClaude\('\/scaffold'/);
  assert.match(smoke, /runClaude\([`'"]\/build --lite/);
  assert.match(smoke, /runClaude\(\s*['"`]\/change/, 'must modify already-generated code via /change');
});

test('smoke verifies behavior in a real browser, not just unit tests', () => {
  const smoke = read(SMOKE);
  assert.match(smoke, /assertInBrowser\(/);
  assert.match(smoke, /startApp\(/);
  assert.match(smoke, /stopApp\(/);
});

test('smoke asserts BOTH the new feature and a regression of the original', () => {
  const smoke = read(SMOKE);
  // v1 verify (original increment) and v2 verify (new decrement + increment still works)
  assert.match(smoke, /increment/i);
  assert.match(smoke, /decrement/i);
  assert.match(smoke, /regression/i);
});

test('smoke has a bounded self-healing fix loop that feeds diagnostics back', () => {
  const smoke = read(SMOKE);
  assert.match(smoke, /verifyWithFix|fix loop|maxAttempts/i);
  // diagnostics (console errors / failing assertion) must feed the repair prompt
  assert.match(smoke, /consoleErrors|diagnostics|error/i);
  assert.match(smoke, /MAX_FIX_ATTEMPTS|maxAttempts/);
});

test('smoke uses preservation/grounded prompts, never bypass prompts', () => {
  const smoke = read(SMOKE);
  assert.doesNotMatch(smoke, /Do not use skills/i);
  assert.doesNotMatch(smoke, /skip pipeline overhead/i);
  assert.doesNotMatch(smoke, /Write code and files directly/i);
});

test('app-runtime helper exposes the lifecycle primitives the smoke depends on', () => {
  const runtime = read(RUNTIME);
  for (const sym of ['startApp', 'stopApp', 'assertInBrowser', 'waitForPort']) {
    assert.match(runtime, new RegExp(`function ${sym}|${sym}\\b`));
  }
});
