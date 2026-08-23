'use strict';

/**
 * One live implementation claim per unit of work.
 *
 * The audited failure: `/auto` ran twice in one session and each invocation
 * dispatched a generator lead for Group A. Two `implementer` agents then
 * implemented story E1-S1 concurrently — 35 and 29 minutes, ~15M cache reads —
 * and wrote SEVEN of the same files (auth_service.py, deps.py, main.py,
 * session_repository.py, auth.py, logging_config.py, test_auth_service.py).
 * The result is last-writer-wins across files that were meant to be consistent.
 *
 * concurrency-gate.js could not see it: it caps HOW MANY subagents run (18),
 * not WHAT they are working on. A quantity gate cannot express "this group
 * already has a lead".
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { claim, release, holders, TTL_MS } = require('../.claude/scripts/work-claim.js');

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-work-claim-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  return dir;
}

test('a free unit of work can be claimed', () => {
  const dir = root();
  const res = claim(dir, 'group:A', { session: 'S1', now: 1000 });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.held_by, null);
  assert.deepStrictEqual(holders(dir).map((h) => h.key), ['group:A']);
});

test('a second claim on a live unit is refused and names the holder', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'S1', now: 1000 });
  const res = claim(dir, 'group:A', { session: 'S2', now: 1000 + 60_000 });

  assert.strictEqual(res.ok, false, 'this is the duplicate-lead bug — it must not be allowed');
  assert.strictEqual(res.held_by.session, 'S1', 'the block must say who holds it, or it is unactionable');
  assert.match(res.reason, /group:A/);
  assert.match(res.reason, /S1/);
});

test('a different unit of work is unaffected', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'S1', now: 1000 });
  assert.strictEqual(claim(dir, 'group:B', { session: 'S2', now: 1000 }).ok, true,
    'the guard is per unit — it must not serialise the whole build');
});

test('releasing frees the unit for a legitimate retry', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'S1', now: 1000 });
  release(dir, 'group:A');
  assert.deepStrictEqual(holders(dir), []);
  assert.strictEqual(claim(dir, 'group:A', { session: 'S2', now: 2000 }).ok, true);
});

test('releasing something never claimed is not an error', () => {
  // Release runs on the failure path too; throwing there would turn a build
  // error into a crash that leaves the claim behind.
  assert.doesNotThrow(() => release(root(), 'group:ZZ'));
});

test('a stale claim is taken over rather than deadlocking the build', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'CRASHED', now: 1000 });
  const res = claim(dir, 'group:A', { session: 'S2', now: 1000 + TTL_MS + 1 });
  assert.strictEqual(res.ok, true, 'a crashed run must not block its group forever');
  assert.strictEqual(res.took_over.session, 'CRASHED', 'a takeover is reported, never silent');
});

test('a claim still inside the TTL is honoured', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'S1', now: 1000 });
  // A real implementer ran 35 minutes; the TTL must comfortably exceed that.
  assert.ok(TTL_MS > 35 * 60_000, 'TTL must not expire under a normal implementer');
  const res = claim(dir, 'group:A', { session: 'S2', now: 1000 + TTL_MS - 1 });
  assert.strictEqual(res.ok, false);
});

test('story-level claims are distinct from their group claim', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'S1', now: 1000 });
  assert.strictEqual(claim(dir, 'story:E1-S1', { session: 'S1', now: 1000 }).ok, true);
  // The duplicate that actually burned an hour was two leads on one story.
  assert.strictEqual(claim(dir, 'story:E1-S1', { session: 'S2', now: 1000 }).ok, false);
});

test('a key cannot escape the state directory', () => {
  const dir = root();
  for (const bad of ['../../etc/passwd', 'group:../A', 'a/b', '']) {
    assert.throws(() => claim(dir, bad, { session: 'S1', now: 1000 }), /invalid claim key/,
      `${JSON.stringify(bad)} must be refused`);
  }
});

test('two claims racing on the same key: exactly one wins', () => {
  // Atomicity matters here — the whole bug is two dispatchers arriving at once.
  const dir = root();
  const results = [claim(dir, 'group:A', { session: 'S1', now: 1000 }),
    claim(dir, 'group:A', { session: 'S2', now: 1000 })];
  assert.strictEqual(results.filter((r) => r.ok).length, 1, 'exactly one claimant may win');
});

test('an unreadable claim file does not wedge the build', () => {
  const dir = root();
  claim(dir, 'group:A', { session: 'S1', now: 1000 });
  const file = holders(dir)[0].file;
  fs.writeFileSync(file, '{ truncated');
  // Unparseable = unknown age = cannot be trusted to still be live. Taking it
  // over is the fail-open choice, and it is reported.
  const res = claim(dir, 'group:A', { session: 'S2', now: 2000 });
  assert.strictEqual(res.ok, true);
  assert.ok(res.took_over, 'a takeover of a corrupt claim must still be reported');
});

// ── Wired, not orphaned ───────────────────────────────────────────────────
// A guard nothing calls is worse than no guard: it reads as covered.

test('/auto claims the group before dispatching its lead, and releases it', () => {
  const section = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'auto', 'references',
      'section-4-4-agent-team-execution-step-4.md'), 'utf8',
  );
  assert.match(section, /work-claim\.js claim group:\{GROUP_ID\}/,
    'the group must be claimed before a lead is spawned');
  assert.match(section, /work-claim\.js release group:\{GROUP_ID\}/,
    'a claim never released would block the next legitimate run');
  assert.match(section, /Exit 2 means a lead is already implementing this group/,
    'the refusal must be stated as a hard block, not a hint');
  // The story is the unit that owns files — group-level alone would still let
  // two leads from different groups collide on a shared file.
  assert.match(section, /work-claim\.js claim story:\{id\}/);
});

test('the guard is registered as a control, with its justification', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'harness-manifest.json'), 'utf8',
  ));
  const entry = [...manifest.guides, ...manifest.sensors].find((e) => e.id === 'work-claim-guard');
  assert.ok(entry, 'an unregistered control is an orphan');
  assert.strictEqual(entry.wired_at, '.claude/scripts/work-claim.js');
  assert.ok(fs.existsSync(path.join(__dirname, '..', entry.wired_at)), 'wired_at must resolve');
  // The control budget only permits a net-add that carries a written reason.
  assert.ok(entry.net_add_justification && entry.net_add_justification.trim().length > 100);
  assert.match(entry.net_add_justification, /concurrency-gate/,
    'the justification must say why the existing gate could not cover this');
});
