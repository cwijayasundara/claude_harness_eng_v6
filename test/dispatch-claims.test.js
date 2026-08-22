'use strict';

// Replays the dispatch defects measured in the sprint-1 baseline run
// (2026-08-21, $47.97), and the three Criticals review found in the FIRST
// attempt to fix them.
//
// That attempt had the gate CLAIM at dispatch time. Every test below marked
// "regression:" pins a failure that design actually produced — including one
// the previous version of this file asserted as correct behaviour, which is how
// it survived a green suite.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { decideNesting, checkClaims, storiesIn } = require('../.claude/hooks/lib/dispatch-claims.js');
const workClaim = require('../.claude/scripts/work-claim.js');

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-claims-'));

// ── Rule 1: nesting ─────────────────────────────────────────────────────────

test('the nested generator is blocked: a subagent may not spawn a generator', () => {
  const r = decideNesting({ subagentType: 'generator', dispatcherIsSubagent: true });
  assert.equal(r.allow, false);
  assert.match(r.reason, /may not spawn a generator/);
});

test('the /auto main loop may still dispatch generators', () => {
  assert.equal(decideNesting({ subagentType: 'generator', dispatcherIsSubagent: false }).allow, true);
});

test('a non-generator subagent dispatch is not caught by the nesting rule', () => {
  assert.equal(decideNesting({ subagentType: 'implementer', dispatcherIsSubagent: true }).allow, true);
  assert.equal(decideNesting({ subagentType: 'evaluator', dispatcherIsSubagent: true }).allow, true);
});

// ── Rule 2: read-only claim check ───────────────────────────────────────────

test('a dispatch onto a story ANOTHER session is implementing is refused', () => {
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'lead-A' });
  const v = checkClaims(r, ['E1-S1'], { sessionId: 'rogue-B' });
  assert.equal(v.allow, false);
  assert.match(v.reason, /already being implemented by session lead-A/);
  assert.match(v.reason, /work-claim\.js release story:E1-S1/, 'a hard block must name its way past');
});

test('regression: the SAME session may dispatch the story it just claimed', () => {
  // /auto's documented team dispatch claims `story:{id}` and THEN spawns the
  // teammate (auto/references/section-4-4, step 5). The first design claimed
  // again at dispatch, and work-claim refuses a live key regardless of session
  // — so the gate blocked every teammate dispatch and team mode could not run.
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'lead-A' });
  assert.equal(checkClaims(r, ['E1-S1'], { sessionId: 'lead-A' }).allow, true,
    'the lead must be able to dispatch the teammate it claimed the story for');
});

test('regression: parallel teammates do not release each other claims', () => {
  // The first design released the OLDEST claim on SubagentStop, because a stop
  // event names an agent type but no story. Under normal parallel fan-out the
  // first teammate to finish released a DIFFERENT teammate's live story, making
  // it re-dispatchable — re-creating the very duplicate the gate exists to
  // stop. The gate no longer writes to the ledger at all, so there is nothing
  // to mis-release: the checks below still hold after any number of stops.
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'lead' });
  workClaim.claim(r, 'story:E6-S1', { session: 'lead' });
  assert.equal(checkClaims(r, ['E1-S1'], { sessionId: 'rogue' }).allow, false);
  assert.equal(checkClaims(r, ['E6-S1'], { sessionId: 'rogue' }).allow, false);
  assert.deepEqual(workClaim.holders(r).map((h) => h.key).sort(), ['story:E1-S1', 'story:E6-S1'],
    'a read-only check must leave the ledger exactly as it found it');
});

test('regression: a multi-story dispatch leaks nothing and blocks no retry', () => {
  // The first design claimed N stories and released 1, leaking the rest for the
  // full 4h TTL and blocking the /auto self-heal retry path.
  const r = root();
  assert.equal(checkClaims(r, ['E1-S1', 'E1-S2'], { sessionId: 'lead' }).allow, true);
  assert.deepEqual(workClaim.holders(r), [], 'the check must claim nothing');
  assert.equal(checkClaims(r, ['E1-S1', 'E1-S2'], { sessionId: 'lead' }).allow, true,
    'a retry must never be blocked by a claim the gate itself invented');
});

test('an unknown session on either side passes — over-blocking stalls the loop', () => {
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'lead-A' });
  assert.equal(checkClaims(r, ['E1-S1'], { sessionId: undefined }).allow, true);
  const r2 = root();
  workClaim.claim(r2, 'story:E1-S1', {}); // session defaults to 'unknown'
  assert.equal(checkClaims(r2, ['E1-S1'], { sessionId: 'anyone' }).allow, true);
});

test('an unclaimed story always passes', () => {
  assert.equal(checkClaims(root(), ['E1-S1'], { sessionId: 'lead' }).allow, true);
});

test('a dispatch naming no story passes and touches nothing', () => {
  const r = root();
  assert.equal(checkClaims(r, storiesIn({ description: 'Approve Group A sprint contract' }), {}).allow, true);
  assert.deepEqual(workClaim.holders(r), []);
});

test('an unreadable ledger passes rather than stalling a dispatch', () => {
  assert.equal(checkClaims('/nonexistent/path/xyz', ['E1-S1'], { sessionId: 'lead' }).allow, true);
});

test('a claim older than the TTL no longer blocks', () => {
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'lead-A', now: Date.now() - (workClaim.TTL_MS + 1000) });
  assert.equal(checkClaims(r, ['E1-S1'], { sessionId: 'rogue' }).allow, true,
    'holders() prunes by TTL so a crashed run cannot block its story forever');
});

test('storiesIn recognises the real shapes', () => {
  assert.deepEqual(storiesIn({ description: 'Implement E12-S3 and E1-S1', prompt: 'E1-S1 again' }), ['E12-S3', 'E1-S1']);
  assert.deepEqual(storiesIn({ description: 'no stories here' }), []);
  assert.deepEqual(storiesIn({}), []);
});
