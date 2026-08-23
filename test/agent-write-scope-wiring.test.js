'use strict';

// Wiring contract for the agent write-scope gate.
//
// A hook that is not in settings.json never runs. This harness has shipped that
// exact failure twice: a PreToolUse matcher of "Task" when the live tool name is
// "Agent" (so the gate was never handed a dispatch), and two hooks that decided
// "am I a subagent?" from `transcript_path` (always false, both inert). Both
// were green the whole time, because nothing asserted the wiring.
//
// So the wiring is a test, not a note in a runbook. Until
// `wire-agent-write-scope.js` has been applied between sessions, this FAILS —
// which is the honest state: the contracts are data and the decision logic is
// proven, but nothing is enforcing them at runtime yet.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const { matcherSelects } = require('../.claude/hooks/lib/subagent-tool.js');

const SETTINGS = path.join(__dirname, '..', '.claude', 'settings.json');
const HOOK = 'agent-write-scope.js';

function preToolUseEntries() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  return ((settings.hooks || {}).PreToolUse) || [];
}

function entriesRunning(hookFile) {
  return preToolUseEntries().filter((entry) => (entry.hooks || [])
    .some((h) => typeof h.command === 'string' && h.command.includes(hookFile)));
}

test('the write-scope gate is wired on PreToolUse', () => {
  const entries = entriesRunning(HOOK);
  assert.ok(entries.length > 0,
    `${HOOK} is not registered in .claude/settings.json — the contracts are inert until it is.\n`
    + 'Apply between sessions: HARNESS_PREFIX_EDIT=1 node .claude/scripts/wire-agent-write-scope.js');
});

test('its matcher actually selects the tools that write', () => {
  const entries = entriesRunning(HOOK);
  if (entries.length === 0) return; // the test above owns that failure
  // Every tool the hook itself handles, not just the two it was written with:
  // the wiring script once installed a three-tool matcher for a four-tool gate.
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    assert.ok(entries.some((e) => matcherSelects(e.matcher, tool)),
      `no wired matcher selects ${tool} — a matcher that cannot match is the "Task" bug again`);
  }
});

test('the hook file the wiring names exists', () => {
  for (const entry of entriesRunning(HOOK)) {
    for (const h of entry.hooks || []) {
      if (!h.command.includes(HOOK)) continue;
      const rel = h.command.replace(/^.*\$CLAUDE_PROJECT_DIR\/?/, '').replace(/["']/g, '').trim();
      assert.ok(fs.existsSync(path.join(__dirname, '..', rel)),
        `settings.json points at ${rel}, which does not exist`);
    }
  }
});
