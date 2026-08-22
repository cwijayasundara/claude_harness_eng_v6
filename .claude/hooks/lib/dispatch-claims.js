'use strict';

// Decision layer for the subagent-dispatch gate.
//
// Two rules, from two measured failures of the same live route:
//
//  1. NESTING. In the 2026-08-21 sprint-1 baseline run, a generator dispatched
//     to PROPOSE a Group B sprint contract implemented Group A instead, by
//     spawning a second generator, which spawned a second E1-S1 implementer.
//     generator.md carries the Agent tool and no rule against spawning its own
//     role, so nesting was unguarded. This invariant is owned here.
//
//  2. IDENTITY — "this work already has an owner". That invariant is NOT owned
//     here: it belongs to work-claim.js (HARNESS.md: work-claim-guard), whose
//     atomic `wx` create is what makes it race-safe. This module only routes a
//     dispatch into that ledger. The guard existed during the audited run and
//     still did not fire, because the /auto skill invokes it in PROSE — so an
//     agent that goes off-script never calls it. A PreToolUse hook claims at
//     dispatch time instead, which an off-script agent cannot skip.
//
// Claims made here are stamped `via: 'dispatch-gate'` so the release path can
// only ever drop its OWN records and can never release one the prose path
// holds. Ambiguity resolves toward ALLOW throughout: over-allowing costs money,
// over-blocking stalls the build loop.

const workClaim = require('../../scripts/work-claim.js');

// Story ids as the spec graph emits them: E<epic>-S<story>, e.g. E1-S1, E12-S3.
const STORY_RE = /\bE\d+-S\d+\b/g;

/** Story ids named in a dispatch's description + prompt, in first-seen order. */
function storiesIn(toolInput) {
  const text = `${(toolInput && toolInput.description) || ''}\n${(toolInput && toolInput.prompt) || ''}`;
  return [...new Set(text.match(STORY_RE) || [])];
}

/** True when the dispatcher is itself a subagent (its transcript is a subagent transcript). */
function isSubagentDispatcher(transcriptPath) {
  return /[/\\]subagents[/\\]/.test(String(transcriptPath || ''));
}

/**
 * Rule 1 only — pure, so the nesting invariant is testable without a filesystem.
 * @returns {{allow:boolean, reason?:string}}
 */
function decideNesting({ subagentType, transcriptPath }) {
  if (String(subagentType || '').trim() === 'generator' && isSubagentDispatcher(transcriptPath)) {
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
 * Rule 2 — claim every story a dispatch names, via work-claim.js.
 * Returns the first refusal, having released whatever it claimed first, so a
 * denied dispatch leaves no half-held work behind.
 */
function claimStories(root, stories, { agent, session, now } = {}) {
  const held = [];
  for (const story of stories) {
    const key = `story:${story}`;
    let res;
    try {
      res = workClaim.claim(root, key, { session, now, note: 'dispatch-gate', via: 'dispatch-gate', agent });
    } catch (_) {
      continue; // an unusable ledger must not stall a dispatch
    }
    if (!res.ok) {
      for (const k of held) workClaim.release(root, k);
      return {
        allow: false,
        reason: `${res.reason}\nTwo agents building one story race on the same files and bill twice.`,
      };
    }
    held.push(key);
  }
  return { allow: true, claimed: held };
}

/**
 * Release on SubagentStop. The stop event names an agent type but not a story,
 * so this drops the OLDEST claim THIS GATE made for that agent type. Restricted
 * to `via: 'dispatch-gate'` records, so a claim the /auto prose path holds is
 * never released out from under a live implementer.
 */
function releaseOldest(root, { agentType } = {}) {
  const agent = String(agentType || '').trim();
  let mine;
  try {
    mine = workClaim.holders(root)
      .filter((h) => h.via === 'dispatch-gate' && (!agent || h.agent === agent))
      .sort((a, b) => (a.claimed_at || 0) - (b.claimed_at || 0));
  } catch (_) { return { released: null }; }
  if (mine.length === 0) return { released: null };
  workClaim.release(root, mine[0].key);
  return { released: mine[0].key };
}

module.exports = { STORY_RE, storiesIn, isSubagentDispatcher, decideNesting, claimStories, releaseOldest };
