'use strict';

// The CLI half of the spec decisions gate: the verdict it stamps, the shaping
// session it carries, and the clear-and-render-only checkpoint it prints.
// Split from validate-spec-decisions.test.js at its 500-line cap; the pure
// validateDecisions rules stay there.

const assert = require('assert');
const { test } = require('node:test');
const { decision, doc } = require('./helpers/spec-decisions-fixture.js');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'validate-spec-decisions.js');

/** A project whose decisions file is valid, with `sessionId` as the live session. */
function decisionsRoot(sessionId, docOver = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-decisions-'));
  fs.mkdirSync(path.join(dir, 'specs/decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/decisions/spec-decisions.json'),
    JSON.stringify(doc(docOver), null, 2));
  fs.mkdirSync(path.join(dir, '.claude/runs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: sessionId })}\n`);
  return dir;
}

const gate = (dir, extra = []) =>
  execFileSync('node', [SCRIPT, '--root', dir, ...extra], { encoding: 'utf8' });

const verdictOf = (dir) => JSON.parse(
  fs.readFileSync(path.join(dir, 'specs/reviews/spec-decisions-verdict.json'), 'utf8'),
);

test('the shaping session is stamped into the verdict', () => {
  const dir = decisionsRoot('SESSION-A');
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-A');
  assert.strictEqual(verdictOf(dir).in_session, false);
});

test('passing the gate prints the clear-and-render-only checkpoint', () => {
  const out = gate(decisionsRoot('SESSION-A'));
  assert.match(out, /OK/);
  assert.match(out, /\/clear/);
  assert.match(out, /then \/spec/);
});

// /build cannot clear itself mid-run, so it must neither be told to nor blocked.
test('--in-session suppresses the checkpoint and records why', () => {
  const dir = decisionsRoot('SESSION-A');
  const out = gate(dir, ['--in-session']);
  assert.match(out, /OK/);
  assert.doesNotMatch(out, /\/clear/);
  assert.strictEqual(verdictOf(dir).in_session, true);
});

// A headless lane has no human to run /clear. Telling it to is noise at best.
test('a waived headless lane gets no checkpoint', () => {
  const dir = decisionsRoot('SESSION-A', { decisions: [decision({ basis: 'headless-default' })] });
  const out = gate(dir, ['--lane', '--autonomous']);
  assert.match(out, /waived/);
  assert.doesNotMatch(out, /\/clear/);
});

test('a failing gate prints no checkpoint — there is nothing durable yet', () => {
  const dir = decisionsRoot('SESSION-A', { decisions: [] });
  assert.throws(
    () => gate(dir),
    (err) => {
      assert.doesNotMatch(String(err.stdout || ''), /\/clear/);
      return err.status === 1;
    },
  );
});

// The stamp must record who SHAPED the decisions, not who last validated them.
//
// spec-render re-runs this gate at its own Step 0. Without this, the happy path
// self-sabotages: the human clears, re-enters with `/spec --render-only`, the
// renderer re-runs the gate, and the verdict is restamped with the FRESH
// session — so the next `handoff-check --stage render` blocks the very session
// the clear just created. /spec's documented unresolved-items loop ("append them
// to decisions[] and re-dispatch with --render-only") walks straight into it.
//
// Same idiom as plan-approval's artifact digests: content unchanged means the
// record still describes the same decisions.

test('re-running the gate on unchanged decisions preserves the shaping session', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SHAPING');

  // The human clears; the renderer re-runs the gate from the fresh session.
  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-FRESH' })}\n`);
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SHAPING',
    'the renderer re-running the gate must not claim to have shaped the decisions');
});

test('changed decisions re-stamp — a new shaping dialogue happened', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);

  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-SECOND' })}\n`);
  const file = path.join(dir, 'specs/decisions/spec-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D2', question: 'Resolve the unresolved item?' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));

  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SECOND');
});

test('the verdict records the decisions digest it was stamped against', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);
  assert.match(verdictOf(dir).decisions_sha256, /^[0-9a-f]{64}$/);
});

// --- who the checkpoint is addressed to ---------------------------------------
//
// spec-render runs this same gate at its Step 0. On a live run it read the
// checkpoint — written for the operator of the shaping session — as an
// instruction to halt, and returned a confident success having written no
// stories. The block is correct for the shaping session and wrong for the one
// agent that must not obey it, so the renderer declares itself and gets no
// block; the text names its own audience for any caller that forgets.

test('--rendering suppresses the checkpoint: the renderer IS the post-clear hop', () => {
  const dir = decisionsRoot('SESSION-A');
  const out = gate(dir, ['--rendering']);
  assert.match(out, /OK/);
  assert.doesNotMatch(out, /\/clear/);
});

// The renderer never shaped anything, so it must never inherit the shaping
// stamp — digest changed or not. Carrying it forward on an UNCHANGED digest is
// already covered above; the case that bites is the documented unresolved-items
// loop, which changes the digest by design: the renderer returns unresolved
// items, the post-clear session appends them to decisions[], and re-dispatches.
// The renderer's own gate is then the first run on the new digest, so without
// --rendering it restamps the verdict with the post-clear session and the next
// handoff-check blocks the very session the clear created — punished for having
// resolved the ambiguity the renderer asked about.
test('--rendering carries the shaping stamp forward even when decisions changed', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SHAPING');

  // The human clears; the post-clear session resolves an unresolved item.
  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-RENDER' })}\n`);
  const file = path.join(dir, 'specs/decisions/spec-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D-RESOLVED', basis: 'human' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));

  gate(dir, ['--rendering']);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SHAPING',
    'the renderer must not claim to have shaped the amended decisions');
});

// The flag is the renderer declaring itself; a SHAPING session amending its own
// decisions must still re-stamp. Without this the two behaviours are
// indistinguishable and the carry-forward above could be an unconditional bug.
test('without --rendering, changed decisions still re-stamp', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);
  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-SECOND' })}\n`);
  const file = path.join(dir, 'specs/decisions/spec-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D-MORE', basis: 'human' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SECOND');
});

// /build conducts every phase from one session and cannot /clear. The renderer
// re-runs the gate WITHOUT --in-session, so in_session must survive the
// renderer's run too, or §3's handoff-check blocks the conductor and tells it
// to pass a flag it already passed.
test('--rendering preserves in_session across an amended decisions file', () => {
  const dir = decisionsRoot('SESSION-A');
  gate(dir, ['--in-session']);
  assert.strictEqual(verdictOf(dir).in_session, true);
  const file = path.join(dir, 'specs/decisions/spec-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D-RESOLVED', basis: 'human' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  gate(dir, ['--rendering']);
  assert.strictEqual(verdictOf(dir).in_session, true,
    '/build cannot /clear; the renderer must not erase the conductor flag');
});

const skillText = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('spec-render Step 0 actually passes --rendering, on both lanes', () => {
  const skill = skillText('.claude/skills/spec-render/SKILL.md');
  assert.match(skill, /validate-spec-decisions\.js --rendering\s+# gated lane/);
  assert.match(skill, /validate-spec-decisions\.js --rendering --lane --auto/);
});

// SKILL.md tells the renderer not to load this file unless a gate fails — i.e.
// it is read exactly when the renderer is already confused. It must agree.
test('the renderer fallback procedure passes --rendering too', () => {
  const doc = skillText('.claude/skills/spec-render/references/render-procedure.md');
  assert.match(doc, /validate-spec-decisions\.js --rendering\s+# gated lane/);
  assert.match(doc, /validate-spec-decisions\.js --rendering --lane --auto/);
});

// The negative half, and the one that matters most. --rendering exists to
// silence the /clear checkpoint; typed at a SHAPING site it would silence the
// control outright — the phase boundary that the metered run showed to be the
// single most expensive stretch of the front half — with a fully green suite.
// Nothing else in the repo pins these two invocations. (The /build
// conductor sites in build/references/section-04-pipeline-phases.md name
// the gates too, but with --in-session and not as runnable lines.)
// Join shell continuations first: `cmd \<newline>  --flag` is ONE command, and a
// per-line regex reads it as two. Without this the assertion below is evadable
// by an ordinary line wrap — which is exactly how a long invocation gets
// written when someone adds a flag to it.
const joinContinuations = (text) => text.replace(/\\\n\s*/g, ' ');

test('the shaping sites must never pass --rendering', () => {
  for (const rel of [
    '.claude/skills/spec/references/shape.md',
    '.claude/skills/design/references/mode-10-step-1-spawn-two-agents-concurrently.md',
  ]) {
    const text = joinContinuations(skillText(rel));
    // Anchored on the INVOCATION, not the script name: `spec-decisions.json`
    // contains the substring `-decisions.js`, so a looser pattern is satisfied
    // by prose about the decisions file.
    const invocation = /node \.claude\/scripts\/validate-(?:spec|design)-decisions\.js/;
    // The positive half is load-bearing: `doesNotMatch` alone is satisfied by a
    // file that no longer runs the gate AT ALL, which is a worse failure than
    // the one being guarded against.
    assert.match(text, invocation, `${rel} must still run the gate`);
    assert.doesNotMatch(text, new RegExp(`${invocation.source}[^\n]*--rendering`),
      `${rel} shapes the decisions — it must print the /clear checkpoint`);
  }
});

// A carried stamp and a freshly-written one are byte-identical on disk, so
// nothing downstream — or a human — can tell that a verdict names a session
// that did not validate this content. The flag is a self-declaration: a caller
// that wrongly passes --rendering inherits whatever stamp was already there.
// That cannot be detected from the stamp alone, but it can be RECORDED.
// `specs/reviews/` is gitignored, so a fresh clone or worktree has no verdict.
// A renderer invoked there is the FIRST run, so there is no stamp to carry —
// and stamping itself would make it the shaper, blocking its own re-dispatch
// after the unresolved-items loop. It shaped nothing, so it claims nothing:
// an unknown stamp, which isResident() passes under the module's own rule that
// every uncertain case passes.
test('a renderer with no prior verdict claims no stamp', () => {
  const dir = decisionsRoot('SESSION-RENDER');
  gate(dir, ['--rendering']);
  const v = verdictOf(dir);
  assert.strictEqual(v.session_id, null, 'the renderer must not become the shaper');
  assert.strictEqual(v.revalidated_by, 'SESSION-RENDER', 'but it is on the record');
});

// A carried stamp names a session that did not see the current content. The
// carry itself is the normal case on every render, so `carried` alone says
// almost nothing; what separates the documented loop from a re-shape is how far
// the content moved under the carry, which needs the digest the stamp was made
// against.
test('a carried stamp records the digest it was originally made against', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);
  const shaped = verdictOf(dir);
  assert.strictEqual(shaped.stamped_against, shaped.decisions_sha256,
    'a fresh stamp vouches for the content in front of it');

  const file = path.join(dir, 'specs/decisions/spec-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D-RESOLVED', basis: 'human' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  gate(dir, ['--rendering']);

  const carried = verdictOf(dir);
  assert.strictEqual(carried.stamped_against, shaped.decisions_sha256,
    'the carried stamp still points at what SESSION-SHAPING actually saw');
  assert.notStrictEqual(carried.decisions_sha256, carried.stamped_against,
    'and the gap to the current digest is what makes the staleness readable');
});

test('a carried stamp records who actually re-validated it', () => {
  const dir = decisionsRoot('SESSION-SHAPING');
  gate(dir);
  assert.strictEqual(verdictOf(dir).revalidated_by, null,
    'a fresh stamp has nothing to disambiguate');

  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-RENDER' })}\n`);
  const file = path.join(dir, 'specs/decisions/spec-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D-RESOLVED', basis: 'human' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  gate(dir, ['--rendering']);

  const v = verdictOf(dir);
  assert.strictEqual(v.session_id, 'SESSION-SHAPING', 'still names the shaper');
  assert.strictEqual(v.carried, true, 'and records that the stamp was carried');
  assert.strictEqual(v.revalidated_by, 'SESSION-RENDER',
    'and who carried it, so a laundered stamp is auditable after the fact');
});
