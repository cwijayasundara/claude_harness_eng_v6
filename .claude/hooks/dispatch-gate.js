'use strict';

// PreToolUse(Task|Agent) dispatch gate: blocks a subagent from spawning a
// generator, and blocks a dispatch onto a story a DIFFERENT session is already
// implementing. Decision logic (and the evidence for both rules) lives in
// lib/dispatch-claims.js; this file is the hook wrapper only.
//
// No SubagentStop handling: the claim lifecycle belongs to work-claim.js, since
// a stop event carries no story to correlate a release with.
//
// Fail-open on any error, like every other gate here: a gate that crashes must
// not be able to stall the build loop.

const fs = require('fs');
const { SUBAGENT_TOOL_NAMES, isSubagentCall } = require('./lib/subagent-tool.js');
const { decideNesting, checkClaims, storiesIn } = require('./lib/dispatch-claims.js');

const TOOL_NAMES = new Set(SUBAGENT_TOOL_NAMES);

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { process.exit(0); }
  try {
    const event = String(input.hook_event_name || '');
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    if (event === 'PreToolUse' && TOOL_NAMES.has(input.tool_name || '')) {
      const toolInput = input.tool_input || {};
      const agent = toolInput.subagent_type || toolInput.agent_type || '';

      const nesting = decideNesting({ subagentType: agent, dispatcherIsSubagent: isSubagentCall(input) });
      if (!nesting.allow) { process.stderr.write(`${nesting.reason}\n`); process.exit(2); }

      const claimed = checkClaims(root, storiesIn(toolInput), { sessionId: input.session_id });
      if (!claimed.allow) { process.stderr.write(`${claimed.reason}\n`); process.exit(2); }
      process.exit(0);
    }
  } catch (_) { process.exit(0); }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { main };
