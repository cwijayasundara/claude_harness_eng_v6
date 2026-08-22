'use strict';

// How big an agent's own context has grown, and what to do about it.
//
// Cache reads are the largest single line in this harness's bill — $27.88 of a
// $47.97 run — and they are the integral of resident context over turns, so a
// context that only ever grows is charged for that growth on every remaining
// turn. Measured on the 2026-08-21 sprint-1 baseline, the E1-S1 implementer ran
// 208 turns from 18K to 324K and cost $16.87 by itself. Its conversation held
// about 111K tokens of real content: 76K of tool results, 32K of tool-use
// inputs (33 Write calls carry whole files), 3K of text. Nothing is ever shed,
// so the last hundred turns each re-read a context mostly made of work already
// finished and committed.
//
// The fix is not a smaller context, it is a SHORTER-LIVED one: hand off to a
// fresh implementer that starts from the files on disk plus a handoff note.
// This is the subagent counterpart of the "clear at artifact boundaries"
// doctrine the main loop already follows.
//
// Ambiguity resolves toward ALLOW, as everywhere else here: an unreadable
// transcript, a missing usage block, or an unknown agent yields no verdict.

const fs = require('fs');

// Soft: start asking for a handoff. Hard: refuse further production writes.
// Set from the measured curve — the audited implementer passed 140K around turn
// 60 of 208 and everything after that was billed against a context above it.
const SOFT_CEILING_TOKENS = 140000;
const HARD_CEILING_TOKENS = 200000;

// Only the last slice of a transcript is needed to find the newest usage block,
// and these files reach megabytes.
const TAIL_BYTES = 256 * 1024;

/** Resident context of a turn: everything the request had to carry. */
function contextOf(usage) {
  if (!usage) return null;
  const n = (usage.cache_read_input_tokens || usage.cache_read_tokens || 0)
    + (usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0)
    + (usage.input_tokens || 0);
  return n > 0 ? n : null;
}

/** Newest resident-context reading in a transcript, or null. */
function currentContext(transcriptPath) {
  let text;
  try {
    const { size } = fs.statSync(transcriptPath);
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (_) { return null; }

  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i]) continue;
    let row;
    try { row = JSON.parse(lines[i]); } catch (_) { continue; } // a truncated first line
    if (row.type !== 'assistant') continue;
    const ctx = contextOf(row.message && row.message.usage);
    if (ctx != null) return ctx;
  }
  return null;
}

/**
 * @param {object} opts {context, isSubagent, writingHandoff, soft, hard}
 * @returns {{level:'ok'|'soft'|'hard', context:number|null, message?:string}}
 */
function decideCeiling(opts = {}) {
  const { context, isSubagent, writingHandoff } = opts;
  const soft = opts.soft || SOFT_CEILING_TOKENS;
  const hard = opts.hard || HARD_CEILING_TOKENS;

  // The main loop has /clear and a human; this ceiling is about agents that
  // cannot clear themselves.
  if (!isSubagent || context == null) return { level: 'ok', context: context == null ? null : context };
  // Refusing the handoff write would strand the very work the handoff exists to
  // carry — the escape has to stay open at every level.
  if (writingHandoff) return { level: 'ok', context };

  const k = Math.round(context / 1000);
  if (context >= hard) {
    return {
      level: 'hard',
      context,
      message: `Context is ${k}K, past the ${Math.round(hard / 1000)}K hand-off ceiling. `
        + 'Every further turn re-reads all of it, and cache reads are the largest line in this '
        + "harness's bill. Stop adding to this context: write what you have learned and what is "
        + 'left to `.claude/state/handoff/<story-id>.md` — files already written, decisions taken, '
        + 'the exact next step — then RETURN to your lead. Reads and Bash stay open, and so does '
        + 'writing the handoff itself. The lead will dispatch a fresh implementer from your note '
        + 'plus the files on disk; it starts near 18K instead of ' + k + 'K.',
    };
  }
  if (context >= soft) {
    return {
      level: 'soft',
      context,
      message: `Context is ${k}K, approaching the ${Math.round(hard / 1000)}K hand-off ceiling. `
        + 'Finish the step you are on, then write `.claude/state/handoff/<story-id>.md` and return '
        + 'to your lead rather than starting new work in this context.',
    };
  }
  return { level: 'ok', context };
}

/** True when the write is the handoff note itself. */
function isHandoffPath(filePath) {
  return /[/\\]\.claude[/\\]state[/\\]handoff[/\\]/.test(String(filePath || ''));
}

module.exports = {
  SOFT_CEILING_TOKENS, HARD_CEILING_TOKENS, TAIL_BYTES,
  contextOf, currentContext, decideCeiling, isHandoffPath,
};
