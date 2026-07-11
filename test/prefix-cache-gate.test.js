'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const WRITE_HOOK = 'pre-write-gate.js';
const BASH_HOOK = 'pre-bash-gate.js';
const ENV = { HARNESS_TDD_GATE: 'off' };

// Paths that are prefix-only (machinery trust-boundary does not cover them).
const PREFIX_ONLY_RELS = ['CLAUDE.md', 'Claude.md', '.mcp.json'];
// Settings are dual-guarded: machinery blocks first in target projects; prefix
// still applies in the harness monorepo where machinery is skipped.
const SETTINGS_PREFIX_RELS = [
  '.claude/settings.json',
  '.claude/settings.auto.json',
  '.claude/settings.local.json',
];

test('pre-write-gate blocks CLAUDE.md and .mcp.json with prefix message', async () => {
  const projectDir = makeHookProject([WRITE_HOOK]);
  for (const rel of PREFIX_ONLY_RELS) {
    const result = await runHook(projectDir, WRITE_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(projectDir, rel), content: 'x\n' },
    }, ENV);
    assert.strictEqual(result.status, 2, `${rel} was not blocked: ${result.stdout}`);
    assert.ok(
      /prompt-cache prefix/i.test(result.stdout),
      `${rel}: expected prefix message, got: ${result.stdout}`
    );
  }
});

test('pre-write-gate blocks settings*.json via prefix inside harness repo', async () => {
  const projectDir = makeHookProject([WRITE_HOOK]);
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'claude-harness-eng-v5' })
  );
  for (const rel of SETTINGS_PREFIX_RELS) {
    const result = await runHook(projectDir, WRITE_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(projectDir, rel), content: '{}\n' },
    }, ENV);
    assert.strictEqual(result.status, 2, `${rel} was not blocked: ${result.stdout}`);
    assert.ok(
      /prompt-cache prefix/i.test(result.stdout),
      `${rel}: expected prefix message, got: ${result.stdout}`
    );
  }
});

test('pre-write-gate blocks CLAUDE.md even inside the harness repo', async () => {
  const projectDir = makeHookProject([WRITE_HOOK]);
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'claude-harness-eng-v5' })
  );
  const result = await runHook(projectDir, WRITE_HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'CLAUDE.md'), content: '# x\n' },
  }, ENV);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(/prompt-cache prefix/i.test(result.stdout), result.stdout);
});

test('HARNESS_PREFIX_EDIT=1 allows prefix edits', async () => {
  const projectDir = makeHookProject([WRITE_HOOK]);
  const result = await runHook(projectDir, WRITE_HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'CLAUDE.md'), content: '# ok\n' },
  }, { ...ENV, HARNESS_PREFIX_EDIT: '1' });
  assert.strictEqual(result.status, 0, result.stdout);
});

test('ordinary project files are not blocked by the prefix gate', async () => {
  const projectDir = makeHookProject([WRITE_HOOK]);
  const result = await runHook(projectDir, WRITE_HOOK, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(projectDir, 'src', 'app.js'),
      content: 'module.exports = {};\n',
    },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('pre-bash-gate blocks shell writes to CLAUDE.md and .mcp.json', async () => {
  const projectDir = makeHookProject([BASH_HOOK]);
  for (const rel of ['CLAUDE.md', '.mcp.json']) {
    const result = await runHook(projectDir, BASH_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: `echo x > ${rel}` },
    }, ENV);
    assert.strictEqual(result.status, 2, `${rel} bash write not blocked: ${result.stdout}`);
    assert.ok(/prompt-cache prefix/i.test(result.stdout), result.stdout);
  }
});

test('pre-bash-gate allows prefix write when HARNESS_PREFIX_EDIT=allow', async () => {
  const projectDir = makeHookProject([BASH_HOOK]);
  const result = await runHook(projectDir, BASH_HOOK, {
    tool_name: 'Bash',
    tool_input: { command: 'echo x > CLAUDE.md' },
  }, { HARNESS_PREFIX_EDIT: 'allow' });
  assert.strictEqual(result.status, 0, result.stdout);
});
