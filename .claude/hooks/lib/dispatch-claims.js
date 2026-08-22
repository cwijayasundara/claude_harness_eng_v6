'use strict';

// Decision layer for the subagent-dispatch gate.
//
// RULE 1 — NESTING (this module owns it). In the 2026-08-21 sprint-1 baseline a
// generator dispatched to PROPOSE a Group B sprint contract implemented Group A
// instead, by spawning a second generator, which spawned a second E1-S1
// implementer. generator.md carries the Agent tool and no rule against spawning
// its own role. This is the guard that would have stopped the real incident.
//
// RULE 2 — IDENTITY (work-claim.js owns it; this module only READS it).
//
// An earlier version of this file CLAIMED at dispatch time. Review found three
// Criticals in that design, all reproduced:
//
//   * /auto's documented team dispatch already claims `story:{id}` before
//     spawning (auto/references/section-4-4, step 5). Claiming again collided
//     with it, and work-claim refuses a live key regardless of session — so the
//     gate blocked EVERY teammate dispatch. Team mode could not run at all.
//   * SubagentStop names an agent type but no story, so releasing the "oldest"
//     claim released a DIFFERENT teammate's live story under normal parallel
//     fan-out — making the live story re-dispatchable and re-creating the exact
//     duplicate this gate exists to prevent.
//   * A dispatch naming N stories claimed N and released 1, leaking the rest
//     for the full TTL and blocking the self-heal retry path.
//
// A lifecycle needs a correlation key between dispatch and stop, and the stop
// event does not carry one. So this module no longer writes: it CHECKS the
// ledger the cooperative path maintains, and refuses a dispatch onto a story a
// DIFFERENT session is already implementing. Same-session dispatch is the
// normal path and always passes; an unknown session on either side passes too,
// because over-blocking stalls the build loop and over-allowing only costs
// money.
//
// KNOWN GAP, stated rather than papered over: the audited incident was two
// generators inside ONE /auto session, and this check allows same-session
// dispatch. work-claim itself is session-blind and would refuse the second lead
// — but only if the PROSE path calls it, and that is precisely the path that
// did not fire. So Rule 2 does not cover the same-session case; **Rule 1
// (nesting) is what actually catches the audited failure**, because the second
// lead arrived by a subagent spawning a generator. Rule 2 adds the
// cross-session case on top. Closing the same-session gap needs a correlation
// key the dispatch payload does not currently carry.

const workClaim = require('../../scripts/work-claim.js');

// Story ids as the spec graph emits them: E<epic>-S<story>, e.g. E1-S1, E12-S3.
const STORY_RE = /\bE\d+-S\d+\b/g;

/** Story ids named in a dispatch's description + prompt, in first-seen order. */
function storiesIn(toolInput) {
  const text = `${(toolInput && toolInput.description) || ''}\n${(toolInput && toolInput.prompt) || ''}`;
  return [...new Set(text.match(STORY_RE) || [])];
}

// Subagent detection lives in subagent-tool.js: a subagent's tool call reports
// the PARENT's transcript_path, so the `/subagents/` test this used to do was
// always false and the nesting rule never fired.

/**
 * Rule 1 only — pure, so the nesting invariant is testable without a filesystem.
 * @returns {{allow:boolean, reason?:string}}
 */
function decideNesting({ subagentType, dispatcherIsSubagent }) {
  if (String(subagentType || '').trim() === 'generator' && dispatcherIsSubagent) {
    return {
      allow: false,
      reason: 'A subagent may not spawn a generator. Only the /auto main loop dispatches generators; '
        + 'a generator that needs work it cannot own must report back to its lead and let it re-plan. '
        + 'In the audited run a Group B contract proposer spawned a generator that re-implemented '
        + 'Group A for 2h13m — $8.73 of a $47.97 build.',
    };
  }
  return { allow: true };
}

/**
 * Rule 2 — refuse a dispatch onto a story another session is implementing.
 *
 * Read-only: the claim lifecycle belongs to work-claim.js and the /auto prose
 * path that calls it. Returns allow:true whenever the answer is not certain.
 */
function checkClaims(root, stories, { sessionId } = {}) {
  if (stories.length === 0) return { allow: true };
  let held;
  try { held = workClaim.holders(root); } catch (_) { return { allow: true }; }

  const byKey = new Map(held.map((h) => [h.key, h]));
  for (const story of stories) {
    const claim = byKey.get(`story:${story}`);
    if (!claim) continue;
    // holders() lists claim FILES and does not prune — that is work-claim's own
    // claim() path. Without this a crashed run's stale claim would block its
    // story for good, which is the deadlock the TTL exists to prevent.
    const age = Number.isFinite(claim.claimed_at) ? Date.now() - claim.claimed_at : null;
    if (age === null || age >= workClaim.TTL_MS) continue;
    const owner = claim.session;
    // Unknown on either side, or the same session: not a duplicate we can prove.
    if (!owner || owner === 'unknown' || !sessionId || owner === sessionId) continue;
    const mins = Math.round(age / 60000);
    return {
      allow: false,
      reason: `story:${story} is already being implemented by session ${owner}`
        + ` (claimed ${mins} min ago). Two agents building one story `
        + 'race on the same files and bill twice — that pattern cost $8.73 of a $47.97 build. '
        + `Wait for it, or release it deliberately: work-claim.js release story:${story}`,
    };
  }
  return { allow: true };
}

module.exports = { STORY_RE, storiesIn, decideNesting, checkClaims };
