const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'review-on-stop.js';

test('a normal stop with no state produces no output', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('surfaces new hook-errors.log entries as an advisory, once', async () => {
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'state', 'hook-errors.log'),
    '2026-06-11T00:00:00Z pre-commit: uv exploded\n'
  );
  const first = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(first.status, 0);
  assert.ok(first.stdout.includes('hook-errors.log'), first.stdout);
  const second = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.ok(!second.stdout.includes('hook-errors.log'), `advisory repeated: ${second.stdout}`);
});

test('emits session-learnings advisories when not blocking', async () => {
  const projectDir = makeHookProject([HOOK]);
  const rules = '# Learned Rules\n' + Array.from({ length: 12 }, (_, i) => `- rule ${i}`).join('\n') + '\n';
  fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'learned-rules.md'), rules);
  const result = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('learned-rules.md'), result.stdout);
});
