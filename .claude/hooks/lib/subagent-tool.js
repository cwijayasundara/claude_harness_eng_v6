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

const fs = require('fs');
const path = require('path');

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

/**
 * Is this hook payload a tool call made INSIDE a subagent?
 *
 * Captured from three live subagent writes: the payload carries `agent_id` and
 * `agent_type`, and a main-loop call carries neither (it carries `effort`
 * instead). `transcript_path` is NOT a discriminator — a subagent's tool call
 * reports the PARENT session's transcript, so the `/subagents/` path test that
 * both hooks originally used was ALWAYS false and made them inert. That is the
 * same defect class as matching on `"Task"` when the tool is `"Agent"`: a
 * predicate that was never checked against a real payload.
 */
function isSubagentCall(input) {
  return Boolean(input && input.agent_id);
}

/**
 * The subagent's OWN transcript, which is where its context size lives.
 *
 * The payload names the parent's transcript, so this is derived:
 *   <dirname(parent)>/<session_id>/subagents/agent-<agent_id>.jsonl
 * Verified against a live probe (37,800 tokens read back against a reported
 * 37,810). The filename is `agent-<agent_id>.jsonl` for both shapes observed —
 * an anonymous agent (`a903f01c6c876463e`) and a named one
 * (`avacuity-audit-b570096b7f21f346`) — so no fuzzy fallback is warranted.
 * Returns null rather than guessing; a caller with no transcript fails open.
 */
function subagentTranscript(input) {
  if (!isSubagentCall(input)) return null;
  const parent = String((input && input.transcript_path) || '');
  const session = String((input && input.session_id) || '');
  if (!parent || !session) return null;
  const file = path.join(path.dirname(parent), session, 'subagents', `agent-${input.agent_id}.jsonl`);
  try {
    return fs.existsSync(file) ? file : null;
  } catch (_) { return null; }
}

module.exports = {
  SUBAGENT_TOOL_NAMES,
  LIVE_SUBAGENT_TOOL,
  matcherSelects,
  matcherCoversSubagentDispatch,
  isSubagentCall,
  subagentTranscript,
};
