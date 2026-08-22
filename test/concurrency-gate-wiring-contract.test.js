'use strict';

// Wiring contract for the subagent-dispatch hooks.
//
// The previous version of this file asserted `matcher === 'Task'` — the exact
// condition that made the PreToolUse gate inert, since a real dispatch arrives
// as tool_name "Agent" and "Task" does not select it. It therefore pinned the
// defect instead of catching it, and stayed green through a live /auto run in
// which 11 unchecked Agent dispatches duplicated a story.
//
// These assertions are about the matcher SELECTING the live tool name, not
// about its spelling, so they cannot be satisfied by a matcher that never fires.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const {
  SUBAGENT_TOOL_NAMES, LIVE_SUBAGENT_TOOL, matcherSelects, matcherCoversSubagentDispatch,
} = require('../.claude/hooks/lib/subagent-tool.js');

const settings = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));

/** Matcher groups in `event` whose hook list runs `script`. */
function groupsRunning(event, script) {
  return (settings.hooks[event] || [])
    .filter((m) => (m.hooks || []).some((h) => (h.command || '').includes(script)));
}

test('the subagent-tool lib agrees that "Task" alone cannot select a real dispatch', () => {
  // Pins the premise the rest of the file rests on: if this ever flips, the
  // matchers below are being checked against the wrong tool name.
  assert.equal(matcherSelects('Task', LIVE_SUBAGENT_TOOL), false);
  assert.ok(SUBAGENT_TOOL_NAMES.includes(LIVE_SUBAGENT_TOOL));
});

for (const script of ['concurrency-gate.js', 'record-run.js', 'dispatch-gate.js']) {
  test(`PreToolUse ${script} is wired to a matcher that selects a real dispatch`, () => {
    const groups = groupsRunning('PreToolUse', script);
    assert.ok(groups.length > 0, `PreToolUse must run ${script} for subagent dispatches`);
    const live = groups.filter((m) => matcherSelects(m.matcher, LIVE_SUBAGENT_TOOL));
    assert.ok(live.length > 0,
      `${script} runs only under matcher(s) ${JSON.stringify(groups.map((m) => m.matcher))}, `
      + `none of which selects tool_name "${LIVE_SUBAGENT_TOOL}" — the hook can never fire.`);
    assert.ok(live.some((m) => matcherCoversSubagentDispatch(m.matcher)),
      `${script} must be wired to a matcher covering every name in `
      + `${JSON.stringify(SUBAGENT_TOOL_NAMES)}, so a Claude Code version change cannot silently unwire it.`);
  });
}

test('PostToolUse record-run is wired to a matcher that selects a real dispatch', () => {
  const groups = groupsRunning('PostToolUse', 'record-run.js');
  assert.ok(groups.some((m) => matcherCoversSubagentDispatch(m.matcher)),
    'PostToolUse record-run.js must cover the subagent-dispatch tool names; '
    + `saw ${JSON.stringify(groups.map((m) => m.matcher))}`);
});

test('concurrency-gate is wired into SubagentStop', () => {
  assert.ok(groupsRunning('SubagentStop', 'concurrency-gate.js').length > 0,
    'SubagentStop must run concurrency-gate.js — without it the in-flight count only ever grows');
});
