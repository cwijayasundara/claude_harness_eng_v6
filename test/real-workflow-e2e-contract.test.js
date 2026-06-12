'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const REAL_WORKFLOW_E2E = path.join(ROOT, 'test', 'e2e', 'harness-real-workflow.test.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('real workflow E2E invokes harness commands instead of direct artifact prompts', () => {
  assert.ok(fs.existsSync(REAL_WORKFLOW_E2E), 'test/e2e/harness-real-workflow.test.js must exist');
  const e2e = fs.readFileSync(REAL_WORKFLOW_E2E, 'utf8');

  for (const command of ['/scaffold', '/brd', '/spec', '/design']) {
    assert.match(e2e, new RegExp(`runClaude\\('${command.replace('/', '\\/')}'`));
  }
  assert.match(e2e, /runClaude\('\/build --lite/);
  assert.match(e2e, /specs\/reviews\/phase-brd-eval\.json/);
  assert.match(e2e, /specs\/reviews\/phase-spec-eval\.json/);
  assert.match(e2e, /specs\/reviews\/phase-design-eval\.json/);
  assert.match(e2e, /runProjectSuite\(PROJECT_DIR\)/);
});

test('real workflow E2E does not bypass skills or planning workflows', () => {
  assert.ok(fs.existsSync(REAL_WORKFLOW_E2E), 'test/e2e/harness-real-workflow.test.js must exist');
  const e2e = fs.readFileSync(REAL_WORKFLOW_E2E, 'utf8');

  assert.doesNotMatch(e2e, /Do not use skills/i);
  assert.doesNotMatch(e2e, /skip pipeline overhead/i);
  assert.doesNotMatch(e2e, /Write code and files directly/i);
  assert.doesNotMatch(e2e, /Just create the files requested/i);
});

test('e2e runner includes the real workflow certification layer', () => {
  const runner = read('test/e2e/run.sh');

  assert.match(runner, /harness-real-workflow\.test\.js/);
  assert.match(runner, /Real Workflow Certification/);
});
