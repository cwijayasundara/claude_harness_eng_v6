'use strict';

// Single source of truth for the subagent-dispatch tool's name.
//
// The real tool_name is "Agent" in this environment (confirmed by direct
// hook-payload capture); "Task" is the name the subagent hooks originally
// shipped against and is kept for forward/backward compatibility across
// Claude Code versions.
//
// This lived as a private constant inside concurrency-gate.js while
// settings.json still matched on "Task" alone, so PreToolUse never fired for a
// real dispatch: the gate handled both names internally and was never handed
// either. The wiring test pinned the defect rather than catching it, asserting
// `matcher === 'Task'`. Both the hooks and the wiring test now derive from
// here, so a matcher that cannot match a real dispatch is a test failure.

const SUBAGENT_TOOL_NAMES = Object.freeze(['Task', 'Agent']);

/** The tool name a real dispatch arrives under. Matchers MUST cover this one. */
const LIVE_SUBAGENT_TOOL = 'Agent';

/**
 * Does a settings.json hook matcher select the given tool name?
 * Matchers are anchored regexes over the whole tool name — "Task" does NOT
 * select "Agent", which is the bug this helper exists to make visible.
 * @param {string} matcher settings.json matcher source
 * @param {string} toolName e.g. "Agent"
 * @returns {boolean}
 */
function matcherSelects(matcher, toolName) {
  if (typeof matcher !== 'string' || matcher === '') return false;
  let re;
  try { re = new RegExp(`^(?:${matcher})$`); } catch (_) { return false; }
  return re.test(toolName);
}

/** True when a matcher selects every name a dispatch can arrive under. */
function matcherCoversSubagentDispatch(matcher) {
  return SUBAGENT_TOOL_NAMES.every((n) => matcherSelects(matcher, n));
}

module.exports = {
  SUBAGENT_TOOL_NAMES,
  LIVE_SUBAGENT_TOOL,
  matcherSelects,
  matcherCoversSubagentDispatch,
};
