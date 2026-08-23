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
const { currentContext, decideCeiling, isNonSourcePath } = require('./lib/context-ceiling.js');
const { isSubagentCall, subagentTranscript } = require('./lib/subagent-tool.js');

/** An env override, where 0 means "disabled" rather than "use the default". */
function ceilingFrom(raw) {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n === 0 ? Infinity : n;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { process.exit(0); }
  try {
    if (String(input.hook_event_name || '') !== 'PreToolUse') process.exit(0);
    // `agent_id` is the discriminator, captured from live subagent payloads.
    // The transcript_path a subagent's tool call reports is the PARENT's, so
    // testing it for `/subagents/` was always false and made this hook inert.
    if (!isSubagentCall(input)) process.exit(0);
    // ...and the parent's transcript is the wrong context to measure, so the
    // subagent's own is derived. No transcript means no verdict.
    const transcriptPath = subagentTranscript(input);
    if (!transcriptPath) process.exit(0);

    const ti = input.tool_input || {};
    const verdict = decideCeiling({
      context: currentContext(transcriptPath),
      isSubagent: true,
      writingHandoff: isNonSourcePath(ti.file_path || ti.path || ''),
      // `|| undefined` would turn an explicit 0 back into the default. A 0 is a
      // deliberate "no ceiling", so it has to survive as Infinity.
      soft: ceilingFrom(process.env.HARNESS_CONTEXT_SOFT_CEILING),
      hard: ceilingFrom(process.env.HARNESS_CONTEXT_HARD_CEILING),
    });

    // Channel matters, and an advisory has exactly one model-facing channel on
    // an exit-0 PreToolUse hook: `hookSpecificOutput.additionalContext`
    // (upstream changelog: "Added support for PreToolUse hooks to return
    // additionalContext to the model", and a later fix for it being dropped).
    // This warning has now been on two channels the model never reads — stderr
    // with exit 0, then plain stdout, which surfaces to the USER in transcript
    // mode. A subagent 50K past the soft ceiling wrote a file and received
    // nothing, twice. Exit 2 + stderr stays correct for the hard tier, which is
    // a refusal rather than an advisory.
    if (verdict.level === 'hard') { process.stderr.write(`${verdict.message}\n`); process.exit(2); }
    if (verdict.level === 'soft') {
      process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: verdict.message,
        },
      })}\n`);
      process.exit(0);
    }
  } catch (_) { process.exit(0); }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { main, ceilingFrom };
