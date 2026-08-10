/**
 * The decisions gate for the /spec shaping→rendering split.
 *
 * This is the control that makes the split real. Without it the renderer would
 * happily expand a decisions file the model wrote entirely by itself, which is
 * the failure the audit found: 6 clarifications, every `basis` ending
 * "Original planner reasoning: …", 1.83 MB of artifacts, 14 real decision
 * points. A decisions file with no human in it is not a decision record.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { validateDecisions } = require('../.claude/scripts/validate-spec-decisions.js');

const decision = (over = {}) => ({
  id: 'D1',
  question: 'Which epics are in milestone 1?',
  chosen: 'E1, E2, E3',
  rationale: 'They are the only ones with no upstream dependency.',
  basis: 'human',
  load_bearing: true,
  ...over,
});

const doc = (over = {}) => ({
  version: 1,
  phase: 'spec',
  source: 'specs/brd/brd.md',
  confirmed_at: '2026-08-05T10:00:00.000Z',
  milestone: { name: 'M1 — ingestion', epics: ['E1', 'E2', 'E3'], deferred_epics: ['E4'] },
  decisions: [decision()],
  ...over,
});

test('a well-formed, human-confirmed decisions file passes', () => {
  const res = validateDecisions(doc());
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.ok, true);
});

test('rejects a decisions file with no decisions at all', () => {
  const res = validateDecisions(doc({ decisions: [] }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /at least one decision/i.test(e)));
});

test('rejects when every decision was authored by the model — the audited failure', () => {
  const res = validateDecisions(doc({
    decisions: [decision({ basis: 'default-accepted', load_bearing: false })],
  }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /human/i.test(e)),
    'a decisions file the human never touched must not unlock the renderer');
});

test('rejects a load-bearing decision the human did not make', () => {
  const res = validateDecisions(doc({
    decisions: [
      decision({ id: 'D1', basis: 'human', load_bearing: false }),
      decision({ id: 'D2', basis: 'default-accepted', load_bearing: true }),
    ],
  }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /D2/.test(e)));
});

test('requires at least one load-bearing decision so the marker cannot be dodged', () => {
  const res = validateDecisions(doc({
    decisions: [decision({ load_bearing: false })],
  }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /load[-_ ]bearing/i.test(e)));
});

test('rejects a decision with no chosen answer', () => {
  const res = validateDecisions(doc({ decisions: [decision({ chosen: '' })] }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /chosen/i.test(e)));
});

test('rejects duplicate decision ids', () => {
  const res = validateDecisions(doc({ decisions: [decision(), decision()] }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /duplicate/i.test(e)));
});

test('rejects an unknown basis value rather than treating it as human', () => {
  const res = validateDecisions(doc({ decisions: [decision({ basis: 'confirmed' })] }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /basis/i.test(e)));
});

test('requires a milestone with at least one epic — the renderer needs a scope', () => {
  const res = validateDecisions(doc({ milestone: { name: 'M1', epics: [] } }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /epic/i.test(e)));
});

test('rejects a non-spec or malformed document outright', () => {
  assert.strictEqual(validateDecisions(null).ok, false);
  assert.strictEqual(validateDecisions(doc({ phase: 'design' })).ok, false);
});

test('headless lanes waive the human requirement but the verdict records it', () => {
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'headless-default', load_bearing: true })] }),
    { lane: '--auto' },
  );
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.waived, '--auto', 'a waiver must be visible in the verdict, not silent');
});

test('a self-declared headless lane is refused when the session says otherwise', () => {
  // --lane is passed by the same agent the gate constrains, one line below the
  // gated form in spec-render's own code block. .claude/state/current-lane is
  // written by record-run.js from the actual invocation, so it arbitrates.
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'headless-default', load_bearing: true })] }),
    { lane: '--auto', sessionLane: 'spec' },
  );
  assert.strictEqual(res.ok, false, 'a claimed waiver must not outrank the recorded lane');
  assert.ok(res.errors.some((e) => /lane/i.test(e)));
});

test('a headless lane confirmed by the session marker still waives', () => {
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'headless-default', load_bearing: true })] }),
    { lane: '--auto', sessionLane: 'build --auto' },
  );
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.waived, '--auto');
});

test('a headless waiver never excuses structural errors', () => {
  const res = validateDecisions(doc({ decisions: [] }), { lane: '--auto' });
  assert.strictEqual(res.ok, false, 'structure is not waivable — only the human requirement is');
});

// --- the render checkpoint ----------------------------------------------------
//
// Once this gate passes, spec-decisions.json IS the state: spec-render and every
// gate after it read the file, not the shaping dialogue. On the audited run the
// stretch after this point was 40 of /spec's 47 turns at a 284K average context.
// The instruction to clear has to arrive here, at the moment the state becomes
// durable — the same reason the phase handoff prints inside plan-approval.

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
  assert.match(out, /\/spec --render-only/);
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
