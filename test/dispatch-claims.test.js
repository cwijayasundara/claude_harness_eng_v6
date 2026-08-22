'use strict';

// Replays the two dispatch defects measured in the sprint-1 baseline run
// (2026-08-21, $47.97). Each asserts the gate BLOCKS the real sequence; the
// allow-cases pin that the loop's normal paths still pass.
//
// The identity invariant is owned by work-claim.js, so these tests exercise it
// through that ledger rather than a second one — a duplicate claim store would
// be exactly the one-owner-per-invariant violation HARNESS.md exists to stop.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const {
  decideNesting, claimStories, releaseOldest, storiesIn, isSubagentDispatcher,
} = require('../.claude/hooks/lib/dispatch-claims.js');
const workClaim = require('../.claude/scripts/work-claim.js');

const MAIN = '/p/projects/slug/e8ec9632.jsonl';
const SUB = '/p/projects/slug/e8ec9632/subagents/agent-aae1486987.jsonl';
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-claims-'));

test('the real duplicate is blocked: a second E1-S1 implementer 5m43s after the first', () => {
  const r = root();
  // 16:20:22 generator -> implementer "Implement E1-S1 auth backend + proxy routes"
  const first = claimStories(r, ['E1-S1'], { agent: 'implementer', session: 'a205177ec' });
  assert.equal(first.allow, true, 'the first dispatch of a story must pass');

  // 16:26:03 a DIFFERENT generator -> implementer, same story
  const dup = claimStories(r, ['E1-S1'], { agent: 'implementer', session: 'a6784df7a' });
  assert.equal(dup.allow, false, 'a second in-flight dispatch of E1-S1 must be blocked');
  assert.match(dup.reason, /already being implemented by session a205177ec/);
  assert.match(dup.reason, /work-claim\.js release story:E1-S1/, 'a hard block must name its recorded way past');
});

test('the nested generator is blocked: a subagent may not spawn a generator', () => {
  const r = decideNesting({ subagentType: 'generator', transcriptPath: SUB });
  assert.equal(r.allow, false);
  assert.match(r.reason, /may not spawn a generator/);
});

test('the /auto main loop may still dispatch generators', () => {
  assert.equal(decideNesting({ subagentType: 'generator', transcriptPath: MAIN }).allow, true);
});

test('a non-generator subagent dispatch is not caught by the nesting rule', () => {
  assert.equal(decideNesting({ subagentType: 'implementer', transcriptPath: SUB }).allow, true);
  assert.equal(decideNesting({ subagentType: 'evaluator', transcriptPath: SUB }).allow, true);
});

test('a denied multi-story dispatch releases what it already claimed', () => {
  const r = root();
  claimStories(r, ['E6-S1'], { agent: 'implementer', session: 'other' });
  const denied = claimStories(r, ['E1-S1', 'E6-S1'], { agent: 'implementer', session: 'me' });
  assert.equal(denied.allow, false);
  assert.deepEqual(workClaim.holders(r).map((h) => h.key), ['story:E6-S1'],
    'E1-S1 must not stay half-claimed by a dispatch that was refused');
});

test('a sequential retry passes once the claim is released on SubagentStop', () => {
  const r = root();
  assert.equal(claimStories(r, ['E1-S1'], { agent: 'implementer' }).allow, true);
  assert.equal(releaseOldest(r, { agentType: 'implementer' }).released, 'story:E1-S1');
  assert.equal(claimStories(r, ['E1-S1'], { agent: 'implementer' }).allow, true,
    'the /auto self-heal retry path must not be blocked by a released claim');
});

test('release never drops a claim the /auto prose path holds', () => {
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'prose-path' }); // via defaults to 'cli'
  assert.equal(releaseOldest(r, { agentType: 'implementer' }).released, null);
  assert.deepEqual(workClaim.holders(r).map((h) => h.key), ['story:E1-S1'],
    'a prose-path claim must survive an automatic release');
});

test('release with no agent type still spares prose-path claims', () => {
  // The load-bearing case for the `via` filter. A SubagentStop that carries no
  // agent type matches every holder on the agent predicate, so without the
  // provenance check an automatic release would drop a claim the /auto prose
  // path is holding for a live implementer. An earlier version of this file
  // asserted the prose-path case only with an agent type set, where the agent
  // predicate already excluded it — so the assertion passed for the wrong
  // reason and a mutation removing the `via` filter survived.
  const r = root();
  workClaim.claim(r, 'story:E1-S1', { session: 'prose-path' }); // via defaults to 'cli'
  assert.equal(releaseOldest(r, { agentType: '' }).released, null,
    'an untyped SubagentStop must not release a claim this gate did not make');
  assert.deepEqual(workClaim.holders(r).map((h) => h.key), ['story:E1-S1']);
});

test('release with no agent type does drop this gate own claim', () => {
  const r = root();
  claimStories(r, ['E1-S1'], { agent: 'implementer' });
  assert.equal(releaseOldest(r, { agentType: '' }).released, 'story:E1-S1');
});

test('a claim stays live past the longest implementer ever measured', () => {
  // The TTL is a crash-recovery valve, not an expiry. The 2026-08-21 baseline
  // ran an E1-S1 implementer for 133 minutes; at the original 90-minute TTL its
  // claim would have gone stale mid-write and a second dispatcher would have
  // taken it over — reproducing the duplicate this guard exists to stop.
  const MEASURED_LONGEST_IMPLEMENTER_MS = 133 * 60 * 1000;
  assert.ok(workClaim.TTL_MS > MEASURED_LONGEST_IMPLEMENTER_MS,
    `TTL ${workClaim.TTL_MS}ms must clear the measured 133-minute implementer`);
  const r = root();
  const t0 = 1_755_800_000_000;
  claimStories(r, ['E1-S1'], { agent: 'implementer', session: 'first', now: t0 });
  const during = claimStories(r, ['E1-S1'], {
    agent: 'implementer', session: 'second', now: t0 + MEASURED_LONGEST_IMPLEMENTER_MS,
  });
  assert.equal(during.allow, false,
    'a still-running 133-minute implementer must keep its claim');
});

test('release drops only this gate claims, oldest first', () => {
  const r = root();
  claimStories(r, ['E1-S1'], { agent: 'implementer', now: 1000 });
  claimStories(r, ['E6-S1'], { agent: 'implementer', now: 2000 });
  assert.equal(releaseOldest(r, { agentType: 'implementer' }).released, 'story:E1-S1');
  assert.deepEqual(workClaim.holders(r).map((h) => h.key), ['story:E6-S1']);
});

test('distinct stories dispatched in parallel all pass', () => {
  const r = root();
  for (const s of ['E1-S1', 'E6-S1', 'E7-S1']) {
    assert.equal(claimStories(r, [s], { agent: 'implementer' }).allow, true,
      `${s} must pass — parallel fan-out is the point of team mode`);
  }
  assert.equal(workClaim.holders(r).length, 3);
});

test('a dispatch naming no story claims nothing', () => {
  const r = root();
  assert.equal(claimStories(r, storiesIn({ description: 'Approve Group A sprint contract' }), {}).allow, true);
  assert.deepEqual(workClaim.holders(r), []);
});

test('storiesIn / isSubagentDispatcher recognise the real shapes', () => {
  assert.deepEqual(storiesIn({ description: 'Implement E12-S3 and E1-S1', prompt: 'E1-S1 again' }), ['E12-S3', 'E1-S1']);
  assert.deepEqual(storiesIn({ description: 'no stories here' }), []);
  assert.deepEqual(storiesIn({}), []);
  assert.equal(isSubagentDispatcher('/a/b/sess/subagents/agent-x.jsonl'), true);
  assert.equal(isSubagentDispatcher('/a/b/sess.jsonl'), false);
});
