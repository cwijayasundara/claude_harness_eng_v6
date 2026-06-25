'use strict';

const assert = require('assert');
const { test } = require('node:test');
const P = require('../.claude/scripts/plan-confidence.js');

// ---- computeConfidence: band boundaries ---------------------------------

const clean = { openQuestions: 0, needsBreakdown: 0, brownfieldConflicts: 0, assumptions: 0, epics: 2, schemaGaps: 0 };

test('a clean plan scores high with no drivers', () => {
  const r = P.computeConfidence(clean);
  assert.strictEqual(r.band, 'high');
  assert.strictEqual(r.score, 1);
  assert.strictEqual(r.hardLow, false);
  assert.deepStrictEqual(r.drivers, []);
});

test('any open question forces low even though the raw score is above threshold', () => {
  const r = P.computeConfidence({ ...clean, openQuestions: 1 });
  assert.strictEqual(r.hardLow, true);
  assert.strictEqual(r.band, 'low');
  assert.ok(r.score >= r.threshold, 'score alone would clear the threshold; the hard trigger is what forces low');
  assert.ok(r.drivers.some((d) => d.signal === 'openQuestions'));
});

test('any needs_breakdown story forces low', () => {
  const r = P.computeConfidence({ ...clean, needsBreakdown: 1 });
  assert.strictEqual(r.hardLow, true);
  assert.strictEqual(r.band, 'low');
});

test('a brownfield risk conflict forces low', () => {
  const r = P.computeConfidence({ ...clean, brownfieldConflicts: 1 });
  assert.strictEqual(r.hardLow, true);
  assert.strictEqual(r.band, 'low');
});

test('assumptions within one-per-epic budget stay high', () => {
  const r = P.computeConfidence({ ...clean, assumptions: 2, epics: 2 });
  assert.strictEqual(r.band, 'high');
  assert.deepStrictEqual(r.drivers, []);
});

test('excess assumptions drop the band to medium without a hard trigger', () => {
  const r = P.computeConfidence({ ...clean, assumptions: 5, epics: 2 }); // 3 excess * 0.1 = 0.3
  assert.strictEqual(r.hardLow, false);
  assert.strictEqual(r.score, 0.7);
  assert.strictEqual(r.band, 'medium');
  assert.ok(r.drivers.some((d) => d.signal === 'assumptions'));
});

test('one schema gap lands exactly on the high boundary', () => {
  const r = P.computeConfidence({ ...clean, schemaGaps: 1 }); // 0.15 -> 0.85
  assert.strictEqual(r.score, 0.85);
  assert.strictEqual(r.band, 'high');
});

test('two schema gaps fall to medium', () => {
  const r = P.computeConfidence({ ...clean, schemaGaps: 2 }); // 0.30 -> 0.70
  assert.strictEqual(r.band, 'medium');
});

test('score clamps at zero under heavy penalties', () => {
  const r = P.computeConfidence({ ...clean, openQuestions: 5 });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.band, 'low');
});

test('config can override the threshold to demote a medium plan to low', () => {
  const sig = { ...clean, assumptions: 5, epics: 2 }; // score 0.7
  assert.strictEqual(P.computeConfidence(sig).band, 'medium');
  assert.strictEqual(P.computeConfidence(sig, { threshold: 0.75 }).band, 'low');
});

test('config can override weights', () => {
  const r = P.computeConfidence({ ...clean, schemaGaps: 1 }, { weights: { schemaGap: 0.5 } });
  assert.strictEqual(r.score, 0.5);
  assert.strictEqual(r.band, 'low');
});

// ---- markdown parsers ----------------------------------------------------

test('sectionBody extracts text until the next same-or-higher heading', () => {
  const md = [
    '# Title',
    '## Assumptions',
    '- a1',
    '- a2',
    '## Open Questions',
    '- q1',
  ].join('\n');
  const body = P.sectionBody(md, 'Assumptions');
  assert.match(body, /a1/);
  assert.match(body, /a2/);
  assert.doesNotMatch(body, /q1/);
});

test('sectionBody returns empty string for a missing section', () => {
  assert.strictEqual(P.sectionBody('# Title\nbody', 'Nope'), '');
});

test('countListItems counts dash, star, and numbered items only', () => {
  const body = ['- one', '* two', '1. three', 'not a list', '', '  - nested'].join('\n');
  assert.strictEqual(P.countListItems(body), 4);
});

test('countListItems on an empty body is zero', () => {
  assert.strictEqual(P.countListItems(''), 0);
});

test('countTableDataRows ignores the header and separator rows', () => {
  const body = ['| ID | Reason |', '| --- | --- |', '| E2-S3 | vague |', '| E4-S1 | multi |'].join('\n');
  assert.strictEqual(P.countTableDataRows(body), 2);
});

test('countTableDataRows is zero when there is only a header', () => {
  assert.strictEqual(P.countTableDataRows('| ID | Reason |\n| --- | --- |'), 0);
});

test('countEpics counts distinct epic ids', () => {
  const md = '| E1 | Auth |\n| E2 | Profile |\n| E2 | dup row |';
  assert.strictEqual(P.countEpics(md), 2);
});

test('countEpics defaults to at least 1 so assumption density never divides by zero', () => {
  assert.strictEqual(P.countEpics(''), 1);
});

// ---- schema gap detection -----------------------------------------------

test('countSchemaGaps is zero for a missing or empty schema file', () => {
  assert.strictEqual(P.countSchemaGaps(null), 0);
  assert.strictEqual(P.countSchemaGaps(''), 0);
  assert.strictEqual(P.countSchemaGaps('   '), 0);
});

test('countSchemaGaps counts hollow definitions and ignores shaped ones', () => {
  const schema = JSON.stringify({
    definitions: {
      User: { type: 'object', properties: { id: { type: 'string' } } }, // shaped
      Empty: {}, // hollow
      Shapeless: { type: 'object' }, // hollow (object, no properties)
      Status: { enum: ['a', 'b'] }, // shaped
    },
  });
  assert.strictEqual(P.countSchemaGaps(schema), 2);
});

test('countSchemaGaps treats a non-empty unparseable schema as one gap', () => {
  assert.strictEqual(P.countSchemaGaps('{ this is not json'), 1);
});

test('countSchemaGaps reads $defs and top-level properties too', () => {
  assert.strictEqual(P.countSchemaGaps(JSON.stringify({ $defs: { A: {}, B: { $ref: '#/x' } } })), 1);
  assert.strictEqual(P.countSchemaGaps(JSON.stringify({ properties: { a: { type: 'string' }, b: {} } })), 1);
});

// ---- brownfield conflict detection --------------------------------------

const RISK_MAP = [
  '| Area | Risk |',
  '| --- | --- |',
  '| auth | High |',
  '| billing | Critical |',
  '| docs | Low |',
].join('\n');

test('countBrownfieldConflicts counts high/critical rows when no strategy exists', () => {
  assert.strictEqual(P.countBrownfieldConflicts(RISK_MAP, null), 2);
  assert.strictEqual(P.countBrownfieldConflicts(RISK_MAP, ''), 2);
});

test('a documented change-strategy clears the conflicts', () => {
  assert.strictEqual(P.countBrownfieldConflicts(RISK_MAP, '# Change Strategy\nexpand-contract'), 0);
});

test('countBrownfieldConflicts is zero with no high/critical seams', () => {
  assert.strictEqual(P.countBrownfieldConflicts('| docs | Low |', null), 0);
  assert.strictEqual(P.countBrownfieldConflicts(null, null), 0);
});

// ---- gatherSignals: reads the standard spec files via an injected reader --

test('gatherSignals derives counts from spec files', () => {
  const files = {
    'specs/brd/brd.md': ['## Assumptions', '- a1', '- a2', '## Open Questions', '- q1'].join('\n'),
    'specs/stories/epics.md': '| E1 | Auth |\n| E2 | Profile |',
    'specs/stories/backlog-needs-breakdown.md': '| ID | Reason |\n| --- | --- |\n| E2-S3 | vague |',
  };
  const sig = P.gatherSignals((rel) => (rel in files ? files[rel] : null));
  assert.strictEqual(sig.assumptions, 2);
  assert.strictEqual(sig.openQuestions, 1);
  assert.strictEqual(sig.epics, 2);
  assert.strictEqual(sig.needsBreakdown, 1);
});

test('gatherSignals tolerates missing files', () => {
  const sig = P.gatherSignals(() => null);
  assert.strictEqual(sig.assumptions, 0);
  assert.strictEqual(sig.openQuestions, 0);
  assert.strictEqual(sig.needsBreakdown, 0);
  assert.strictEqual(sig.epics, 1);
});

test('gatherSignals derives schema gaps and brownfield conflicts from design/brownfield files', () => {
  const files = {
    'specs/design/api-contracts.schema.json': JSON.stringify({ definitions: { Get: {}, Post: { type: 'object' } } }),
    'specs/design/data-models.schema.json': JSON.stringify({ definitions: { User: { type: 'object', properties: { id: {} } } } }),
    'specs/brownfield/risk-map.md': RISK_MAP,
  };
  const sig = P.gatherSignals((rel) => (rel in files ? files[rel] : null));
  assert.strictEqual(sig.schemaGaps, 2); // two hollow api defs; data model is shaped
  assert.strictEqual(sig.brownfieldConflicts, 2); // high + critical, no change-strategy
  assert.strictEqual(P.computeConfidence(sig).band, 'low'); // brownfield conflict is a hard trigger
});

test('computeConfidence consumes gatherSignals output end to end', () => {
  const sig = P.gatherSignals((rel) =>
    rel === 'specs/stories/backlog-needs-breakdown.md'
      ? '| ID | Reason |\n| --- | --- |\n| E2-S3 | vague |'
      : null
  );
  const r = P.computeConfidence(sig);
  assert.strictEqual(r.band, 'low'); // needs_breakdown is a hard trigger
});
