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

const { decision, doc } = require('./helpers/spec-decisions-fixture.js');

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
  const res = validateDecisions(doc({ milestone: { name: 'M1', epics: [], requirements_in_scope: ['FR-1'] } }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /epic/i.test(e)));
});

test('requires requirements_in_scope so the renderer cannot invent the milestone set', () => {
  const res = validateDecisions(doc({
    milestone: { name: 'M1', epics: ['E1'], deferred_epics: [] },
  }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /requirements_in_scope/i.test(e)));
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

// ── An unattended run must still record a deliberate basis ────────────────
// A recorded lane used to skip the human rules ENTIRELY, so an unattended run
// could pass with every decision left at "default-accepted" — the model's own
// default, chosen by nobody — or with no load-bearing decision at all. The lane
// now relaxes WHICH basis counts, not WHETHER one is required: "headless-default"
// says an unattended operator settled the call, and that is visible in the
// record instead of being indistinguishable from human review.

test('a recorded lane accepts headless-default without a single human decision', () => {
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'headless-default', load_bearing: true })] }),
    { lane: '--auto', sessionLane: 'build --auto' },
  );
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.ok, true);
});

test('a recorded lane still rejects default-accepted on a load-bearing decision', () => {
  // The distinction the whole change is for: "headless-default" is an
  // unattended decision, "default-accepted" is no decision.
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'default-accepted', load_bearing: true })] }),
    { lane: '--auto', sessionLane: 'build --auto' },
  );
  assert.strictEqual(res.ok, false, 'a lane relaxes which basis counts, not whether one is required');
  assert.ok(res.errors.some((e) => /default-accepted/.test(e) && /headless-default/.test(e)),
    `the error must name both the basis found and the one expected: ${JSON.stringify(res.errors)}`);
});

test('a recorded lane still requires a load-bearing decision to exist', () => {
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'headless-default', load_bearing: false })] }),
    { lane: '--auto', sessionLane: 'build --auto' },
  );
  assert.strictEqual(res.ok, false, 'an unattended run that marked nothing load-bearing shaped nothing');
  assert.ok(res.errors.some((e) => /load_bearing/.test(e)));
});

test('without a lane, headless-default does not stand in for human', () => {
  const res = validateDecisions(
    doc({ decisions: [decision({ basis: 'headless-default', load_bearing: true })] }),
  );
  assert.strictEqual(res.ok, false, 'a gated run must not settle its own load-bearing calls');
  assert.ok(res.errors.some((e) => /must be "human"/.test(e)));
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
