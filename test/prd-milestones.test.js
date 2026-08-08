/**
 * The PRD's milestone plan, made machine-readable (R4, link 1).
 *
 * /prd produces a Milestones section and /spec never read it, so the milestone
 * scope decision — which epics get decomposed to story depth NOW and which stay
 * at epic granularity — was re-derived by hand from memory every time. That
 * decision is the biggest single control on how much the pipeline generates: a
 * real run expanded 16 epics against a plan-confidence of 0.
 *
 * Parsed from the PRD copy /brd already keeps at specs/brd/source-frd.md, so no
 * new source of truth is introduced.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { parseMilestones } = require('../.claude/hooks/lib/prd-milestones.js');

const BULLETS = `# PRD: Triage

## 7. Milestones
- **M1 — Ingestion** (FR-1, FR-2). Done when: a workbook uploads and lists in the browser.
- **M2 — Ranking** (FR-3). Done when: the ranked list renders in the browser.
`;

// The audited PRD writes milestones as a table with P-prefixed ids and an
// "Exit criteria" column instead of a "Done when:" label.
const TABLE = `# PRD: X

## 10. Milestones

| Phase | Solo | Exit criteria |
|---|---|---|
| **P0** Corpus + foundations | wks 1-3 | Synthetic corpus with ground-truth graph; schema v0 |
| **P1** Ingest + query (FR-1.1, FR-1.2) | 3-6 | 20k files ingested < 1 h |
`;

test('bullet milestones parse with id, name, requirements and done-when', () => {
  const ms = parseMilestones(BULLETS);
  assert.deepStrictEqual(ms.map((m) => m.id), ['M1', 'M2']);
  assert.strictEqual(ms[0].name, 'M1 — Ingestion');
  assert.deepStrictEqual(ms[0].requirements, ['FR-1', 'FR-2']);
  assert.match(ms[0].done_when, /uploads and lists in the browser/);
});

test('table milestones parse, using the last cell as the done-when', () => {
  const ms = parseMilestones(TABLE);
  assert.deepStrictEqual(ms.map((m) => m.id), ['P0', 'P1']);
  assert.match(ms[0].done_when, /Synthetic corpus/);
  assert.deepStrictEqual(ms[1].requirements, ['FR-1.1', 'FR-1.2']);
});

test('a milestone naming no requirements is kept, with an empty list', () => {
  assert.deepStrictEqual(parseMilestones(TABLE)[0].requirements, [],
    'P0 names none — an empty list, not a dropped milestone');
});

test('order is preserved — it is the build sequence, not a set', () => {
  assert.deepStrictEqual(parseMilestones(BULLETS).map((m) => m.id), ['M1', 'M2']);
});

test('a document with no milestones yields an empty plan rather than throwing', () => {
  assert.deepStrictEqual(parseMilestones('# PRD\n\n## 3. Functional Requirements\n- **FR-1** x\n'), []);
  assert.deepStrictEqual(parseMilestones(''), []);
  assert.deepStrictEqual(parseMilestones(null), []);
});

test('an unobservable done-when is flagged on the milestone, not silently kept', () => {
  const ms = parseMilestones('## 7. Milestones\n- **M1 — X** (FR-1). Done when: it works.\n');
  assert.strictEqual(ms[0].observable, false,
    'the milestone still parses, but it cannot gate a deploy and says so');
  assert.strictEqual(parseMilestones(BULLETS)[0].observable, true);
});

test('a requirement id mentioned in prose is not mistaken for a milestone', () => {
  const ms = parseMilestones('## 7. Milestones\n\nP95 latency is tracked per milestone.\n\n- **M1 — X** (FR-1). Done when: it renders.\n');
  assert.deepStrictEqual(ms.map((m) => m.id), ['M1'],
    'only a bullet or table row declares a milestone');
});

// R4 wiring: the plan has to be produced, read, and carried across sessions, or
// it is three disconnected artifacts again.
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('brd-adopt emits the plan, /spec reads it, /build writes the log', () => {
  assert.match(read('.claude', 'scripts', 'brd-adopt.js'), /brd-milestones\.json/,
    'adoption must emit the plan');
  assert.match(read('.claude', 'skills', 'spec', 'SKILL.md'), /brd-milestones\.json/,
    '/spec must read the plan rather than re-deriving scope from memory');
  assert.match(read('.claude', 'skills', 'build', 'references', 'section-04-pipeline-phases.md'),
    /milestone-log\.template\.md/, '/build must write the log at the end of a milestone');
});

test('/spec reads prior milestone logs, closing the cross-session loop', () => {
  assert.match(read('.claude', 'skills', 'spec', 'SKILL.md'), /specs\/milestones\/\*-log\.md/,
    'the next milestone must start from what exists, not from what was intended');
});

test('the log template demands the two sections that carry the weight', () => {
  const tpl = read('.claude', 'templates', 'milestone-log.template.md');
  assert.match(tpl, /Decisions taken that the PRD did not specify/);
  assert.match(tpl, /Deviations from the PRD, and why/);
  assert.match(tpl, /write "none" explicitly/i,
    'an absent section and no deviations are different facts');
});

// Scanning the whole document made a priority legend parse as a build plan, and
// the id/done-when extraction only worked for the bold and table forms. That
// mattered more once the output became a persisted artifact /spec is told to
// treat as "the build sequence the human already decided".
test('a priority legend outside the Milestones section is not a build plan', () => {
  const doc = '## 4. Priorities\n- P0 must-have\n- P1 should-have\n\n'
    + '## 7. Milestones\n- **M1 — Ingest** (FR-1). Done when: it lists in the browser.\n';
  assert.deepStrictEqual(parseMilestones(doc).map((m) => m.id), ['M1'],
    'only rows under a Milestones heading declare milestones');
});

test('a priority table outside the section is not a build plan either', () => {
  const doc = '## 4. Priorities\n\n| id | meaning |\n|---|---|\n| **P0** | Launch blocker |\n\n'
    + '## 7. Milestones\n- **M1 — X** (FR-1). Done when: it renders.\n';
  assert.deepStrictEqual(parseMilestones(doc).map((m) => m.id), ['M1']);
});

test('the em-dash bullet form yields a real done-when, not a false warning', () => {
  const m = parseMilestones('## 7. Milestones\n- M1 — Ingest — Done when: it lists in the browser.\n')[0];
  assert.strictEqual(m.id, 'M1');
  assert.match(m.done_when, /lists in the browser/);
  assert.strictEqual(m.observable, true);
});

test('a colon after the id is punctuation, not part of the id', () => {
  const m = parseMilestones('## 7. Milestones\n- M1: Ingest. Done when: it lists.\n')[0];
  assert.strictEqual(m.id, 'M1');
});

test('a document with no Milestones heading yields no plan', () => {
  assert.deepStrictEqual(parseMilestones('## 4. Priorities\n- P0 must-have\n'), []);
});
