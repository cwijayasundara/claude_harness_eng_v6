'use strict';

// PreToolUse(Write|Edit|MultiEdit) context ceiling for subagents.
//
// An implementer cannot /clear itself, so an unbounded context is billed on
// every remaining turn. Decision logic and the measured evidence live in
// lib/context-ceiling.js; this file is the hook wrapper.
//
// Scoped to source WRITES on purpose: Read and Bash stay open at every level,
// so an agent told to hand off can still gather what it needs to write the
// note — and the note itself is exempt. Fail-open on any error.

const fs = require('fs');
const { currentContext, decideCeiling, isHandoffPath } = require('./lib/context-ceiling.js');

const SUBAGENT_TRANSCRIPT = /[/\\]subagents[/\\]/;

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { process.exit(0); }
  try {
    if (String(input.hook_event_name || '') !== 'PreToolUse') process.exit(0);
    const transcriptPath = String(input.transcript_path || '');
    const isSubagent = SUBAGENT_TRANSCRIPT.test(transcriptPath);
    // Short-circuit only: decideCeiling exempts the main loop anyway. This
    // exists so a main-loop write does not pay a transcript read on every
    // Write/Edit — removing it changes cost, not behavior, which is why no
    // test pins it.
    if (!isSubagent) process.exit(0);

    const ti = input.tool_input || {};
    const verdict = decideCeiling({
      context: currentContext(transcriptPath),
      isSubagent,
      writingHandoff: isHandoffPath(ti.file_path || ti.path || ''),
      soft: Number(process.env.HARNESS_CONTEXT_SOFT_CEILING) || undefined,
      hard: Number(process.env.HARNESS_CONTEXT_HARD_CEILING) || undefined,
    });

    if (verdict.level === 'hard') { process.stderr.write(`${verdict.message}\n`); process.exit(2); }
    if (verdict.level === 'soft') { process.stderr.write(`${verdict.message}\n`); process.exit(0); }
  } catch (_) { process.exit(0); }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { main };
