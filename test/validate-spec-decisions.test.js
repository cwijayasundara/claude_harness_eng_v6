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

test('a headless waiver never excuses structural errors', () => {
  const res = validateDecisions(doc({ decisions: [] }), { lane: '--auto' });
  assert.strictEqual(res.ok, false, 'structure is not waivable — only the human requirement is');
});
