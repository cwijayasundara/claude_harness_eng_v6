/**
 * PRD shape gate (R3).
 *
 * docs/prd-format.md has always defined the entry artifact, and nothing has
 * ever checked one — while `--autonomous` and `--auto` both *require* a PRD.
 * The id discipline is what makes `/brd --prd` deterministic and, since R2,
 * literally lossless: brd-adopt.js carries FR/NFR text verbatim into the
 * grounding spine. A requirement with no id, or a requirement with no
 * observable postcondition, is therefore not a formatting nit — it is a
 * requirement that can be silently dropped, or one the evaluator has no oracle
 * for and will pass by default.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { validatePrd } = require('../.claude/scripts/validate-prd.js');

const GOOD = `# PRD: Workbook Triage

## 1. Problem & Goal
Analysts cannot tell which of 4,000 workbooks matter. Success is a ranked list.

## 2. Users & Jobs-to-be-done
Engagement analysts triaging an inherited corpus.

## 3. Functional Requirements
- **FR-1** The system accepts an .xlsx upload up to 50 MB.
- **FR-2** The system ranks workbooks by formula density.

## 4. Non-Functional Requirements
- **NFR-1** Ranking of 4,000 workbooks completes in under 20 minutes.
- **NFR-2** Uploaded workbooks are encrypted at rest with AES-256.

## 5. Out of Scope
- No mobile client in v1.
- No real-time collaborative editing.

## 6. Acceptance / Done
- **FR-1** → a 40 MB .xlsx upload returns 201 and a stored corpus id.
- **FR-2** → given 4,000 workbooks, a ranked list is returned with a score per row.

## 7. Milestones
- **M1 — Ingestion** (FR-1). Done when: a workbook can be uploaded and listed in the browser.
- **M2 — Ranking** (FR-2). Done when: the ranked list renders in the browser.
`;

const withoutSection = (heading) => GOOD.split('\n')
  .filter((l) => !l.startsWith(`## ${heading}`)).join('\n');

test('a well-formed PRD passes', () => {
  const res = validatePrd(GOOD);
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.ok, true);
});

test('every functional requirement must have an observable postcondition', () => {
  const missing = GOOD.replace('- **FR-2** → given 4,000 workbooks, a ranked list is returned with a score per row.\n', '');
  const res = validatePrd(missing);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /FR-2/.test(e) && /acceptance|postcondition/i.test(e)),
    'a requirement with no oracle is one the evaluator passes by default');
});

test('an acceptance entry naming an unknown requirement is refused', () => {
  const res = validatePrd(GOOD.replace('- **FR-2** → given 4,000', '- **FR-9** → given 4,000'));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /FR-9/.test(e)));
});

test('duplicate requirement ids are refused — they collapse in the spine', () => {
  const res = validatePrd(GOOD.replace('- **FR-2** The system ranks', '- **FR-1** The system ranks'));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /duplicate/i.test(e)));
});

test('an empty Out of Scope is refused — silence reads as permitted', () => {
  const res = validatePrd(GOOD.replace(/- No mobile client in v1\.\n- No real-time collaborative editing\.\n/, ''));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /out of scope/i.test(e)));
});

test('the deny-list and the acceptance oracle are required', () => {
  for (const heading of ['5. Out of Scope', '6. Acceptance / Done']) {
    const res = validatePrd(withoutSection(heading));
    assert.strictEqual(res.ok, false, `${heading} must be required`);
  }
});

test('but a missing Functional Requirements *heading* is fine when the ids are still there', () => {
  // Substance, not layout. The requirements are what matter, and a real PRD
  // often declares them under topic headings rather than one canonical section.
  const res = validatePrd(withoutSection('3. Functional Requirements'));
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.requirements.map((r) => r.id).filter((i) => i.startsWith('FR-')), ['FR-1', 'FR-2']);
});

test('placeholder text anywhere is refused', () => {
  for (const filler of ['TBD', 'TODO', 'XXX', '???']) {
    const res = validatePrd(GOOD.replace('by formula density', filler));
    assert.strictEqual(res.ok, false, `"${filler}" must not survive into the grounding spine`);
  }
});

test('an adjective-only NFR is warned about, not blocked', () => {
  // "fast" is unfalsifiable, but a PRD is a human document and a hard block on
  // prose would be more annoying than useful. Say it and let them decide.
  const vague = GOOD.replace('Ranking of 4,000 workbooks completes in under 20 minutes.', 'Ranking is fast.');
  const res = validatePrd(vague);
  assert.strictEqual(res.ok, true, 'a vague NFR does not block');
  assert.ok(res.warnings.some((w) => /NFR-1/.test(w)), 'but it must be surfaced');
});

test('milestones each need an observable done-when', () => {
  const res = validatePrd(GOOD.replace('Done when: the ranked list renders in the browser.', 'Done when: it works.'));
  assert.ok(res.warnings.some((w) => /M2/.test(w)),
    'a milestone with no observable end-state cannot gate a deploy');
});

// A real, good PRD does not necessarily use these exact headings. The audited
// one groups requirements under "EPIC n / FR-n.m" headings, states its
// postconditions as inline "AC:" lines rather than a separate section, and
// calls its deny-list "Non-goals". Blocking that on heading text would be
// measuring layout instead of substance — and brd-adopt.js already treats
// Non-goals as Out of Scope, so the two would have disagreed.
const VARIANT = `# PRD: Workbook Triage

## 1. Problem
Analysts cannot tell which workbooks matter.

## 2. Non-goals
- No mobile client in v1.

## 5. EPIC 1 / FR-1.1
The system accepts an .xlsx upload up to 50 MB.
AC: a 40 MB upload returns 201 and a stored corpus id.

## 5. EPIC 1 / FR-1.2
The system ranks workbooks by formula density.
AC: given 4,000 workbooks, a ranked list is returned with a score per row.
`;

test('a heading-per-requirement PRD with inline AC lines is accepted', () => {
  const res = validatePrd(VARIANT);
  assert.deepStrictEqual(res.errors, [], 'substance, not heading text, is what matters');
  assert.deepStrictEqual(res.requirements.map((r) => r.id), ['FR-1.1', 'FR-1.2']);
});

test('Non-goals satisfies the deny-list, matching what brd-adopt already accepts', () => {
  assert.ok(!validatePrd(VARIANT).errors.some((e) => /out of scope/i.test(e)));
});

test('a heading-style requirement with no AC line is still refused', () => {
  const res = validatePrd(VARIANT.replace('AC: given 4,000 workbooks, a ranked list is returned with a score per row.\n', ''));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /FR-1\.2/.test(e)));
});

// The audited PRD writes its NFRs and milestones as markdown TABLES, and some
// of its FRs as bullets outside any "Functional Requirements" heading. Scanning
// only named sections for only bullets found none of them: checkNfrs and
// checkMilestones produced nothing at all on the real artifact, so three of the
// four checks were inert while the suite was green on bullet fixtures.
const TABLES = `# PRD: Triage

## 2. Non-goals
- No mobile client.

**FR-1 Upload**
AC: a 40 MB upload returns 201.

## 6. Non-functional

| id | requirement |
|---|---|
| **NFR-1** | Ranking is fast. |
| **NFR-2** | Encrypted at rest with AES-256. |

## 10. Milestones

| id | scope | done when |
|---|---|---|
| **M1** | Ingestion | a workbook uploads and lists in the browser |
| **M2** | Ranking | it works |
`;

test('requirements in table rows are collected', () => {
  const res = validatePrd(TABLES);
  assert.ok(res.requirements.some((r) => r.id === 'NFR-1'), 'a table row is a real requirement shape');
  assert.ok(res.requirements.some((r) => r.id === 'NFR-2'));
});

test('a vague NFR in a table is still warned about', () => {
  assert.ok(validatePrd(TABLES).warnings.some((w) => /NFR-1/.test(w)),
    'checkNfrs must fire on table-shaped NFRs, not silently find nothing');
});

test('a milestone in a table row is still checked for an observable done-when', () => {
  assert.ok(validatePrd(TABLES).warnings.some((w) => /M2/.test(w)));
});

test('a section that exists but parses to zero requirements is an error, not silence', () => {
  // The failure mode this guards: a heading present, the parser finding nothing,
  // and every downstream check passing because it had nothing to check.
  const opaque = `# PRD: X

## 2. Non-goals
- none stated yet, deliberately.

**FR-1 Thing**
AC: it returns 201.

## 6. Non-functional Requirements

Some prose about performance with no ids at all.
`;
  const res = validatePrd(opaque);
  assert.ok(res.errors.some((e) => /non-functional/i.test(e) && /no .*ids|zero/i.test(e)),
    'a requirements section with no parseable ids must fail loudly');
});

test('a PRD with no requirements at all fails rather than passing vacuously', () => {
  const res = validatePrd('# PRD: Nothing\n\n## 3. Functional Requirements\n\n## 5. Out of Scope\n- none\n\n## 6. Acceptance / Done\n');
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /no functional requirements/i.test(e)));
});

// A PRD that carries a traceability matrix or a deferral note restates ids the
// document already declared. Treating a restatement as a second declaration
// hard-blocks the document — and punishes exactly the traceability table the
// harness itself advocates.
const RESTATED = `# PRD: Triage

## 2. Non-goals
- No mobile client.

- **FR-1** The system accepts an upload.
- **FR-2** The system ranks workbooks.

## 6. Acceptance / Done
- **FR-1** → a 40 MB upload returns 201.
- **FR-2** → a ranked list is returned.

## 8. Traceability

| requirement | area | status |
|---|---|---|
| **FR-1** | ingest | planned |
| **FR-2** | ranking | planned |

## 9. Deferrals
- **FR-2** is deferred to v2 if P1 slips.
`;

test('a restated id is not a second declaration', () => {
  const res = validatePrd(RESTATED);
  assert.deepStrictEqual(res.errors, [],
    'a traceability matrix and a deferral note must not read as duplicate requirements');
  assert.deepStrictEqual(res.requirements.map((r) => r.id), ['FR-1', 'FR-2']);
});

test('the first sighting is the one whose text is kept', () => {
  const res = validatePrd(RESTATED);
  assert.match(res.requirements.find((r) => r.id === 'FR-1').text, /accepts an upload/);
});

// Narrowing duplicate detection to bullets-inside-a-requirements-section (to
// stop a traceability matrix reading as a redeclaration) left a hole: the
// heading and bold pseudo-heading forms — which the audited PRD uses
// throughout — could declare the same id twice and be silently collapsed, the
// second declaration's text discarded with no error.
//
// Those two forms are unambiguously declarations. A restatement uses a table
// row or a prose bullet; nobody restates a requirement by writing its heading
// again.
const dupPrd = (body) => `# PRD: X\n\n## 2. Non-goals\n- none deliberately.\n\n${body}`;

test('a duplicate declared twice in bold pseudo-heading form is caught', () => {
  const res = validatePrd(dupPrd(
    '**FR-1 Upload**\nAC: returns 201.\n\n**FR-1 Something else**\nAC: returns 200.\n',
  ));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /duplicate requirement id FR-1\b/.test(e)));
});

test('a duplicate declared twice in heading form is caught', () => {
  const res = validatePrd(dupPrd(
    '## 5. EPIC 1 / FR-1.1\nThing one. AC: returns 201.\n\n## 5. EPIC 1 / FR-1.1\nThing two. AC: returns 200.\n',
  ));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /duplicate requirement id FR-1\.1/.test(e)));
});

test('but a table row or prose bullet restating a declared id is still fine', () => {
  const res = validatePrd(dupPrd(
    '**FR-1 Upload**\nAC: returns 201.\n\n## 8. Traceability\n\n| req | area |\n|---|---|\n'
    + '| **FR-1** | ingest |\n\n## 9. Deferrals\n- **FR-1** slips to v2 if P1 slips.\n',
  ));
  assert.deepStrictEqual(res.errors, []);
});
