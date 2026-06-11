/**
 * User-label hygiene: git config user.name values wrapped in quote characters
 * (e.g. a global config set as `git config user.name “name”` with smart
 * quotes) must not leak quote glyphs into metric labels — they pollute the
 * dashboard's $user variable. HARNESS_USER stays verbatim (explicit override).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { runHook, makeProject } = require('./helpers/record-run-fixture');

test('record-run strips quote characters from git-derived user names', async () => {
  const projectDir = makeProject();
  execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', '“dev one”'], { cwd: projectDir });

  // HARNESS_USER empty -> falls through to git config user.name.
  const result = await runHook(projectDir, {
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    session_id: 'user-label',
    tool_response: { is_error: false },
  }, { HARNESS_USER: '', HARNESS_PUSHGATEWAY_URL: '' });
  assert.equal(result.status, 0, result.stderr);

  const ledger = fs.readFileSync(
    path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl'), 'utf8'
  ).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(ledger[0].user, 'dev one');
});
