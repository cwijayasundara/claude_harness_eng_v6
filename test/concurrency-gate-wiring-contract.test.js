'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const settings = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));

function commandsFor(hookList) {
  return (hookList || []).flatMap((m) => (m.hooks || []).map((h) => h.command || ''));
}

test('concurrency-gate is wired into the PreToolUse Task matcher', () => {
  const taskMatchers = (settings.hooks.PreToolUse || []).filter((m) => m.matcher === 'Task');
  const cmds = commandsFor(taskMatchers);
  assert.ok(cmds.some((c) => c.includes('concurrency-gate.js')), 'PreToolUse Task must run concurrency-gate.js');
});

test('concurrency-gate is wired into SubagentStop', () => {
  const cmds = commandsFor(settings.hooks.SubagentStop);
  assert.ok(cmds.some((c) => c.includes('concurrency-gate.js')), 'SubagentStop must run concurrency-gate.js');
});
