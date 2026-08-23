#!/usr/bin/env node

'use strict';

// One live implementation claim per unit of work.
//
// The audited failure: `/auto` ran twice in one session, and each invocation
// dispatched a generator lead for Group A. Two `implementer` agents then
// implemented story E1-S1 concurrently — 35 and 29 minutes, ~15M cache reads —
// and wrote SEVEN of the same files. The surviving contents are last-writer-wins
// across files that were meant to be consistent with each other.
//
// `concurrency-gate.js` cannot see that: it caps HOW MANY subagents run, not
// WHAT they work on. A quantity gate has no way to express "this group already
// has a lead". This is the identity half.
//
// Atomicity matters, because the whole failure is two dispatchers arriving at
// once: a claim is an exclusive file create (`wx`), so exactly one caller wins
// even under a genuine race. One file per key rather than a shared JSON
// document, for the same reason.
//
// Usage:
//   node .claude/scripts/work-claim.js claim   group:A [--session ID] [--root DIR]
//   node .claude/scripts/work-claim.js release group:A [--root DIR]
//   node .claude/scripts/work-claim.js list [--root DIR]
// Exit: 0 claimed/released, 2 refused (already held), 3 usage.

const fs = require('fs');
const path = require('path');
const { liveSessionId } = require('../hooks/lib/live-session.js');

/**
 * Who is making this claim.
 *
 * The env var is CLAUDE_CODE_SESSION_ID. `CLAUDE_SESSION_ID` — which this read
 * used on its own — is a skill string substitution, not an environment
 * variable, so it is never set in a Bash subprocess and every CLI claim
 * recorded `unknown`. dispatch-claims.js skips an `unknown` owner by design
 * (it cannot prove a duplicate against an owner it does not know), so the
 * cross-session rule was inert on the only path /auto actually uses. The
 * legacy name is kept as a fallback, and the run receipts are the last
 * resort — they name the live session when no env var does.
 *
 * `unknown` remains a legitimate answer. It fails OPEN: an unenforceable
 * claim must never become a block on evidence nobody has.
 */
function resolveSession(root, explicit) {
  return explicit
    || process.env.CLAUDE_CODE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || liveSessionId(root)
    || 'unknown';
}

// The TTL exists only so a CRASHED run cannot block its group forever, not as a
// normal expiry — so it must clear the longest LIVE implementer comfortably.
// First set to 90 min against a 35-minute implementer. The 2026-08-21 sprint-1
// baseline then ran an E1-S1 implementer for 133 minutes, which a 90-minute TTL
// would have declared stale WHILE IT WAS STILL WRITING FILES — a second
// dispatcher would have taken the claim over and produced exactly the duplicate
// this guard exists to stop. 4h clears the measured worst case ~1.8x.
const TTL_MS = 4 * 60 * 60 * 1000;

// `group:A`, `story:E1-S1`. Anything that could walk out of the state dir is
// refused rather than sanitised — a silently rewritten key would claim the
// wrong unit and the guard would pass while protecting nothing.
const KEY = /^[A-Za-z0-9]+:[A-Za-z0-9._-]+$/;

function claimsDir(root) {
  return path.join(root, '.claude', 'state', 'work-claims');
}

function claimFile(root, key) {
  if (typeof key !== 'string' || !KEY.test(key)) {
    throw new Error(`invalid claim key ${JSON.stringify(key)} — expected <kind>:<id>, e.g. group:A`);
  }
  return path.join(claimsDir(root), `${key.replace(':', '__')}.json`);
}

function readClaim(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

/**
 * Claim a unit of work.
 *
 * Returns `{ok:false, held_by, reason}` when a live claim exists — that refusal
 * IS the fix. `took_over` is set when a stale or unreadable claim was
 * reclaimed; a takeover is always reported, never silent, because it means a
 * previous run died mid-implementation and its partial work is still on disk.
 */
function claim(root, key, opts = {}) {
  const file = claimFile(root, key);
  const now = opts.now == null ? Date.now() : opts.now;
  const record = {
    key,
    session: resolveSession(root, opts.session),
    note: opts.note || null,
    claimed_at: now,
    // Who made the claim. dispatch-gate.js releases only its OWN records, so an
    // automatic release can never drop a claim the /auto prose path is holding
    // for a live implementer.
    via: opts.via || 'cli',
    agent: opts.agent || null,
  };
  fs.mkdirSync(claimsDir(root), { recursive: true });

  try {
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    return { ok: true, held_by: null, took_over: null, file };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  const existing = readClaim(file);
  // Unparseable means unknown age, which cannot be trusted to still be live.
  const age = existing && Number.isFinite(existing.claimed_at) ? now - existing.claimed_at : null;
  if (existing && age !== null && age < TTL_MS) {
    return {
      ok: false,
      held_by: existing,
      took_over: null,
      file,
      reason: `${key} is already being implemented by session ${existing.session} `
        + `(claimed ${Math.round(age / 60000)} min ago). Dispatching a second lead for the same `
        + 'work is what produced two implementers writing the same files. '
        + `Wait for it, or release it deliberately: work-claim.js release ${key}`,
    };
  }

  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { ok: true, held_by: null, took_over: existing || { session: 'unreadable' }, file };
}

function release(root, key) {
  try { fs.unlinkSync(claimFile(root, key)); } catch (_) { /* never claimed, or already gone */ }
}

function holders(root) {
  let names;
  try { names = fs.readdirSync(claimsDir(root)); } catch (_) { return []; }
  return names.filter((n) => n.endsWith('.json')).map((n) => {
    const file = path.join(claimsDir(root), n);
    return { ...(readClaim(file) || { key: n.replace('__', ':').replace(/\.json$/, '') }), file };
  });
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  const sessionIdx = argv.indexOf('--session');
  const session = sessionIdx >= 0 ? argv[sessionIdx + 1] : undefined;
  const [command, key] = argv;

  if (command === 'list') {
    const live = holders(root);
    if (!live.length) process.stdout.write('work-claim: nothing in flight\n');
    for (const h of live) {
      process.stdout.write(`work-claim: ${h.key} held by ${h.session} `
        + `(${Math.round((Date.now() - h.claimed_at) / 60000)} min)\n`);
    }
    return 0;
  }
  if (command === 'release') {
    release(root, key);
    process.stdout.write(`work-claim: released ${key}\n`);
    return 0;
  }
  if (command === 'claim') {
    const res = claim(root, key, { session });
    if (!res.ok) {
      process.stderr.write(`work-claim: REFUSED\n  ${res.reason}\n`);
      return 2;
    }
    if (res.took_over) {
      process.stdout.write(`work-claim: claimed ${key} — TOOK OVER a stale claim from `
        + `${res.took_over.session}. A previous run died mid-implementation; its partial work is `
        + 'still on disk, so verify the tree before trusting it.\n');
    } else {
      process.stdout.write(`work-claim: claimed ${key}\n`);
    }
    return 0;
  }
  process.stderr.write('usage: work-claim.js claim|release|list <kind>:<id> [--session ID] [--root DIR]\n');
  return 3;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`work-claim: ${err.message}\n`);
    process.exit(3);
  }
}

module.exports = { claim, release, holders, claimFile, TTL_MS };
