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
 *
 * The digest alone is not enough, because the documented unresolved-items loop
 * changes it on purpose: the renderer returns unresolved items, the post-clear
 * session appends them to decisions[] and re-dispatches, and the renderer's own
 * Step 0 gate is then the first run on the new digest. `rendering` is the
 * renderer declaring itself, and a renderer never shaped anything — changed
 * digest or not — so it carries the stamp forward unconditionally. Without it
 * the loop self-blocks (and /build --in-session, which cannot /clear, is told
 * to pass the flag it already passed).
 */
function stampFor(root, prior, decisionsSha, inSession, rendering) {
  const live = liveSessionId(root);
  const carry = prior && prior.session_id
    && (rendering || prior.decisions_sha256 === decisionsSha);
  if (carry) {
    // `carried`/`revalidated_by`/`stamped_against` exist because the flag is a
    // self-declaration: a caller that wrongly passes --rendering inherits
    // whatever stamp was on disk, and a carried stamp is otherwise
    // byte-identical to a fresh one. A carry happens on every render, so
    // `carried` alone says little; `stamped_against` is the discriminating
    // part — it keeps the digest the stamp was ORIGINALLY made against, so the
    // gap to the current `decisions_sha256` shows how far the content moved
    // under a stamp that never saw it. Recorded for post-hoc audit; nothing
    // reads it yet. `inSession` is deliberately ignored here: the prior record
    // owns it, or /build's conductor flag would be erased by the renderer.
    return {
      session_id: prior.session_id,
      in_session: prior.in_session === true,
      carried: true,
      revalidated_by: live,
      stamped_against: prior.stamped_against || prior.decisions_sha256 || null,
    };
  }
  if (rendering) {
    // First run, nothing to carry. The renderer shaped nothing, so it claims
    // nothing rather than stamping itself — which would make it the shaper and
    // block its own re-dispatch after the unresolved-items loop. An unknown id
    // passes isResident, per this module's "every uncertain case passes" rule.
    return {
      session_id: null,
      in_session: inSession === true,
      carried: false,
      revalidated_by: live,
      stamped_against: null,
    };
  }
  return {
    session_id: live,
    in_session: inSession === true,
    carried: false,
    revalidated_by: null,
    stamped_against: decisionsSha,
  };
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
 * @param {boolean} [args.rendering] caller is the renderer, not the shaping
 *   session. Note that `inSession` is ignored whenever a stamp is carried.
 */
function writeDecisionVerdict({
  root, gate, verdictRel, decisionsRel, result, lane, inSession, rendering,
}) {
  const out = path.join(root, verdictRel);
  const decisionsSha = sha256Of(path.join(root, decisionsRel));
  const stamp = stampFor(root, readJson(out), decisionsSha, inSession, rendering);
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
