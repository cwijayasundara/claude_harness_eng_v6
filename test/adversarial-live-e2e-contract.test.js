'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const LIVE_E2E = path.join(ROOT, 'test', 'e2e', 'harness-adversarial-live.test.js');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('live adversarial E2E runs Claude against every brownfield fixture and re-runs tests', () => {
  assert.ok(fs.existsSync(LIVE_E2E), 'test/e2e/harness-adversarial-live.test.js must exist');
  const e2e = fs.readFileSync(LIVE_E2E, 'utf8');

  assert.match(e2e, /runClaude\(/);
  assert.match(e2e, /loadManifest\(/);
  assert.match(e2e, /scenario\.lane === 'brownfield'/);
  assert.match(e2e, /copyFixture\(/);
  assert.match(e2e, /runFixtureSuite\(/);
  assert.match(e2e, /assertProtectedFilesStillExist\(/);
  assert.match(e2e, /assertForbiddenPatternsAbsent\(/);
});

test('live adversarial E2E uses preservation-oriented prompts, not bypass prompts', () => {
  assert.ok(fs.existsSync(LIVE_E2E), 'test/e2e/harness-adversarial-live.test.js must exist');
  const e2e = fs.readFileSync(LIVE_E2E, 'utf8');

  assert.match(e2e, /existing brownfield codebase/i);
  assert.match(e2e, /preserve/i);
  assert.match(e2e, /protected_files/);
  assert.match(e2e, /required_behaviors/);
  assert.doesNotMatch(e2e, /Do not use skills/i);
  assert.doesNotMatch(e2e, /skip pipeline overhead/i);
  assert.doesNotMatch(e2e, /Write code and files directly/i);
  assert.doesNotMatch(e2e, /Just create the files requested/i);
});

test('e2e runner includes the live adversarial mutation layer', () => {
  const runner = read('test/e2e/run-pack.js');

  assert.match(runner, /harness-adversarial-live\.test\.js/);
  assert.match(runner, /Live Adversarial Mutation/);
});
