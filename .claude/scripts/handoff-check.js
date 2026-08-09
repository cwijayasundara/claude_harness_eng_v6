#!/usr/bin/env node

'use strict';

// Refuse to start a planning phase inside the conversation that approved its
// predecessor.
//
// `plan-approval.js record --verdict approved` already prints a handoff asking
// the operator to /clear before the next phase. On a live run it was printed and
// ignored: /spec continued in /brd's session and ran 47 turns at a 273K average
// context, against ~110K for a fresh one. Printing louder is not a control —
// the successor refusing to start is.
//
// The signal is deterministic. `record` stamps the approving session's id into
// the receipt; the live id comes from the run receipts the hooks already write.
// Same id means the approving conversation is still resident.
//
// Every uncertain case passes — no receipt, no session id, a receipt written
// before stamping existed. A control that fires on missing evidence reports a
// context problem for someone else's failure and teaches operators to bypass it.
//
// Usage:
//   node .claude/scripts/handoff-check.js --phase <spec|design|test> [--root DIR]
//                                         [--in-session]
//
// Exit: 0 = clear to proceed, 1 = stale context, 2 = usage error.

const path = require('path');
const { staleContext, PREV_PHASE } = require('../hooks/lib/phase-handoff.js');
const { liveSessionId } = require('../hooks/lib/live-session.js');
const { readReceipt } = require('./plan-approval.js');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

function run(argv, cwd, deps = {}) {
  const phase = arg(argv, '--phase', null);
  if (!phase || !Object.prototype.hasOwnProperty.call(PREV_PHASE, phase)) {
    process.stderr.write(
      `handoff-check: --phase must be one of ${Object.keys(PREV_PHASE).join(' | ')}\n`
    );
    return 2;
  }
  const root = path.resolve(arg(argv, '--root', cwd) || cwd);
  const verdict = staleContext({
    phase,
    receipt: readReceipt(root, PREV_PHASE[phase]),
    sessionId: (deps.liveSessionId || liveSessionId)(root),
    inSession: argv.includes('--in-session'),
  });
  if (!verdict.blocked) {
    process.stdout.write(
      `handoff-check: ${phase} OK — not the session that approved /${PREV_PHASE[phase]}.\n`
    );
    return 0;
  }
  process.stderr.write(`handoff-check: ${phase} BLOCKED — stale context.\n${verdict.message}`);
  return 1;
}

module.exports = { run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
