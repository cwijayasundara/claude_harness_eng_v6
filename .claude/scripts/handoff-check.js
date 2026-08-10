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

const fs = require('fs');
const path = require('path');
const {
  staleContext, staleRenderContext, PREV_PHASE, RENDER_PHASES,
} = require('../hooks/lib/phase-handoff.js');
const { liveSessionId } = require('../hooks/lib/live-session.js');
const { readReceipt } = require('./plan-approval.js');

// The render stage is defined for the phases that can re-enter after the clear
// via `--render-only`. A block on a phase with no such flag would strand it.
const RENDER_STAGE_PHASES = new Set(Object.keys(RENDER_PHASES));

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Usage error message for a bad --phase/--stage pair, or null when valid. */
function usageError(phase, stage) {
  if (stage !== 'boundary' && stage !== 'render') {
    return `--stage must be boundary | render (default boundary), got "${stage}"`;
  }
  if (stage === 'render' && !RENDER_STAGE_PHASES.has(phase)) {
    return `--stage render is defined only for ${[...RENDER_STAGE_PHASES].join(', ')}`;
  }
  if (stage === 'boundary' && !Object.prototype.hasOwnProperty.call(PREV_PHASE, phase)) {
    return `--phase must be one of ${Object.keys(PREV_PHASE).join(' | ')}`;
  }
  return null;
}

// The two checkpoints read different records: the boundary one reads the
// predecessor's approval receipt, the render one reads the decisions verdict.
function verdictFor(stage, root, phase, sessionId, inSession) {
  if (stage === 'render') {
    return staleRenderContext({
      phase,
      verdict: readJson(path.join(root, RENDER_PHASES[phase].verdict)),
      sessionId,
      inSession,
    });
  }
  return staleContext({ phase, receipt: readReceipt(root, PREV_PHASE[phase]), sessionId, inSession });
}

function okLine(stage, phase) {
  return stage === 'render'
    ? `handoff-check: ${phase} render OK — not the session that shaped the decisions.\n`
    : `handoff-check: ${phase} OK — not the session that approved /${PREV_PHASE[phase]}.\n`;
}

function run(argv, cwd, deps = {}) {
  const phase = arg(argv, '--phase', null);
  const stage = arg(argv, '--stage', 'boundary');
  const problem = usageError(phase, stage);
  if (problem) {
    process.stderr.write(`handoff-check: ${problem}\n`);
    return 2;
  }
  const root = path.resolve(arg(argv, '--root', cwd) || cwd);
  const verdict = verdictFor(
    stage, root, phase,
    (deps.liveSessionId || liveSessionId)(root),
    argv.includes('--in-session'),
  );
  if (!verdict.blocked) {
    process.stdout.write(okLine(stage, phase));
    return 0;
  }
  process.stderr.write(`handoff-check: ${phase} BLOCKED — stale context.\n${verdict.message}`);
  return 1;
}

module.exports = { run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
