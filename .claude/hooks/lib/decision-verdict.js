'use strict';

// The persisted verdict of a decisions gate, shared by /spec and /design.
//
// Both gates write the same record: pass/waiver provenance, plus the stamp that
// makes the render checkpoint work. Keeping one owner is the point — the stamp
// has a subtle rule (below) that was already wrong once, and two copies of it
// would drift.
//
// A verdict written to stdout is gone the moment the run ends, so it is
// persisted the way plan-approval.js leaves a receipt: a later step, or a human
// asking "was this waived?", can check.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { liveSessionId } = require('./live-session.js');

function sha256Of(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function sessionLane(root) {
  try {
    return fs.readFileSync(path.join(root, '.claude', 'state', 'current-lane'), 'utf8').trim();
  } catch (_) {
    return null;
  }
}

/**
 * Who SHAPED these decisions — not who last validated them.
 *
 * The renderer re-runs its gate at its own Step 0. Restamping there makes the
 * checkpoint self-defeating: the human clears, re-enters with `--render-only`,
 * the renderer re-runs the gate, and the verdict now names the fresh session —
 * so the next render check blocks the very session the clear created.
 *
 * So the stamp is carried forward while the decisions themselves are unchanged,
 * keyed on a digest, the way plan-approval.js keeps an approval tied to the
 * artifacts it approved. Changed decisions do re-stamp: that is a new shaping
 * dialogue, and the next render stretch should start clear of it.
 */
function stampFor(root, prior, decisionsSha, inSession) {
  if (prior && prior.decisions_sha256 === decisionsSha && prior.session_id) {
    return { session_id: prior.session_id, in_session: prior.in_session === true };
  }
  return { session_id: liveSessionId(root), in_session: inSession === true };
}

/**
 * Write a decisions-gate verdict. Best-effort: a receipt we cannot write must
 * not block the gate itself.
 *
 * @param {object} args
 * @param {string} args.root project root
 * @param {string} args.gate gate id, e.g. 'spec-decisions'
 * @param {string} args.verdictRel where the verdict lands, relative to root
 * @param {string} args.decisionsRel the decisions file, relative to root
 * @param {{ok: boolean, errors: string[], waived: string|null}} args.result
 * @param {string|null} args.lane the claimed --lane, if any
 * @param {boolean} args.inSession caller conducts every phase in one session
 */
function writeDecisionVerdict({ root, gate, verdictRel, decisionsRel, result, lane, inSession }) {
  const out = path.join(root, verdictRel);
  const decisionsSha = sha256Of(path.join(root, decisionsRel));
  const stamp = stampFor(root, readJson(out), decisionsSha, inSession);
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify({
      gate,
      pass: result.ok,
      waived_by: result.waived,
      claimed_lane: lane || null,
      session_lane: sessionLane(root),
      decisions_sha256: decisionsSha,
      ...stamp,
      errors: result.errors,
      checked_at: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (_) { /* a receipt we cannot write must not block the gate */ }
}

module.exports = { writeDecisionVerdict, stampFor, sessionLane, sha256Of };
