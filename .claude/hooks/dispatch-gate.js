'use strict';

// PreToolUse(Task|Agent) + SubagentStop dispatch gate: blocks a subagent from
// spawning a generator, and blocks a second in-flight dispatch of a story that
// is already being built. Decision logic (and the evidence for both rules)
// lives in lib/dispatch-claims.js; this file is the hook wrapper only.
//
// Fail-open on any error, like every other gate here: a gate that crashes must
// not be able to stall the build loop.

const fs = require('fs');
const { SUBAGENT_TOOL_NAMES } = require('./lib/subagent-tool.js');
const { decideNesting, claimStories, releaseOldest, storiesIn } = require('./lib/dispatch-claims.js');

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

      const nesting = decideNesting({ subagentType: agent, transcriptPath: input.transcript_path || '' });
      if (!nesting.allow) { process.stderr.write(`${nesting.reason}\n`); process.exit(2); }

      const stories = storiesIn(toolInput);
      if (stories.length > 0) {
        const claimed = claimStories(root, stories, { agent, session: input.session_id || undefined });
        if (!claimed.allow) { process.stderr.write(`${claimed.reason}\n`); process.exit(2); }
      }
      process.exit(0);
    }

    if (event === 'SubagentStop') {
      const agentType = input.agent_type || input.subagent_type
        || (input.tool_input && input.tool_input.subagent_type) || '';
      releaseOldest(root, { agentType });
      process.exit(0);
    }
  } catch (_) { process.exit(0); }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { main };
