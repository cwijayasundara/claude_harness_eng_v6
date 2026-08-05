/**
 * PRD adoption (R2).
 *
 * With a real PRD, /brd re-expressed 149 source requirements as 88 BRD ones and
 * the grounding gate then proved the mapping lossless in both directions —
 * 149/149, 0 net-new, 0 dropped. That is a formal proof that 258 KB of frontier
 * output added no requirement content: BR-1 is a paraphrase of FRD-1.
 *
 * Adoption removes the paraphrase. The PRD's own ids become the spine, so
 * grounding is an identity rather than something a model must be trusted to
 * preserve. What /brd genuinely adds — the ten-slot taxonomy floor, the
 * analysis pack, the clarification log — is unaffected and still runs.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const {
  adoptRequirements, adoptSafeguards, adoptAcceptance,
} = require('../.claude/scripts/brd-adopt.js');

const FRD = [
  { id: 'FR-1', text: 'MUST accept an .xlsx upload up to 50 MB.', section: '3. Functional Requirements' },
  { id: 'FR-2', text: 'MUST rank workbooks by formula density.', section: '3. Functional Requirements' },
  { id: 'NFR-1', text: 'p95 latency under 200ms.', section: '4. Non-Functional Requirements' },
  { id: 'OOS-1', text: 'No mobile client in v1.', section: '5. Out of Scope' },
];

test('requirement ids and text are carried across verbatim', () => {
  const { requirements } = adoptRequirements(FRD);
  const fr1 = requirements.find((r) => r.id === 'FR-1');
  assert.strictEqual(fr1.text, 'MUST accept an .xlsx upload up to 50 MB.',
    'adoption must not reword — rewording is what the grounding gate then has to prove lossless');
});

test('each adopted requirement traces to itself, making grounding an identity', () => {
  const { requirements } = adoptRequirements(FRD);
  for (const r of requirements) {
    assert.deepStrictEqual(r.traces, [r.id], `${r.id} must trace to its own source id`);
  }
});

test('out-of-scope entries become safeguards, not requirements', () => {
  const { requirements } = adoptRequirements(FRD);
  assert.ok(!requirements.some((r) => r.id === 'OOS-1'),
    'an explicit non-goal is a deny-list entry, never something to build');
  const safeguards = adoptSafeguards(FRD);
  assert.strictEqual(safeguards.length, 1);
  assert.strictEqual(safeguards[0].kind, 'forbidden_action');
  assert.deepStrictEqual(safeguards[0].traces, ['OOS-1']);
});

test('taxonomy is left unassigned rather than guessed', () => {
  // Slot classification is a judgement the ten-slot floor then checks. Writing
  // a plausible-looking default here would satisfy that gate without anyone
  // having decided anything — the failure mode this whole wave is about.
  const { requirements } = adoptRequirements(FRD);
  assert.ok(requirements.every((r) => r.taxonomy === null),
    'adoption assigns no taxonomy; the gate must still force the question');
});

test('nothing is dropped: every source requirement is adopted or made a safeguard', () => {
  const { requirements } = adoptRequirements(FRD);
  const safeguards = adoptSafeguards(FRD);
  const accounted = new Set([
    ...requirements.flatMap((r) => r.traces),
    ...safeguards.flatMap((s) => s.traces),
  ]);
  for (const src of FRD) {
    assert.ok(accounted.has(src.id), `${src.id} was neither adopted nor recorded as a safeguard`);
  }
});

// A real PRD spine carries the postcondition for FR-1.1 in a section named
// "5. EPIC 1 / FR-1.1 AC". Adopted naively those become standalone requirements
// — the spine grows by every acceptance criterion and each one then demands its
// own story. brd-acceptance.json is where they belong; /spec Step 6.46 proves
// criterion-level coverage from it.
//
// Shaped like the REAL spine, which the first version of this fixture was not:
// ids are extractor-assigned (FRD-n) and the PRD's own identifier (FR-1.1)
// appears only in the section label. Linking acceptance by id therefore never
// matches — on the real 149-entry spine every one of the 11 criteria warned
// "names requirement FR-4.2, which is not in the spine".
const WITH_AC = [
  { id: 'FRD-40', text: 'MUST accept an .xlsx upload.', section: '5. EPIC 1 / FR-1.1' },
  { id: 'FRD-41', text: 'Given a 40 MB file, when uploaded, then 201.', section: '5. EPIC 1 / FR-1.1 AC' },
  { id: 'FRD-42', text: 'MUST rank workbooks.', section: '5. EPIC 1 / FR-1.2' },
];

test('acceptance-criterion entries become acceptance, not requirements', () => {
  const { requirements } = adoptRequirements(WITH_AC);
  assert.deepStrictEqual(requirements.map((r) => r.id), ['FRD-40', 'FRD-42'],
    'an AC section must not inflate the requirement spine');
});

test('each acceptance entry links to the requirement its section names', () => {
  const acceptance = adoptAcceptance(WITH_AC);
  assert.strictEqual(acceptance.length, 1);
  assert.strictEqual(acceptance[0].requirement, 'FR-1.1', 'the link is the PRD identifier from the section');
  assert.strictEqual(acceptance[0].text, 'Given a 40 MB file, when uploaded, then 201.');
});

test('the requirement carries its acceptance ids so coverage is checkable', () => {
  const { requirements } = adoptRequirements(WITH_AC);
  const fr = requirements.find((r) => r.id === 'FRD-40');
  assert.deepStrictEqual(fr.acceptance, ['FRD-41'],
    'acceptance must attach to the requirement sharing its PRD identifier, not its extractor id');
  assert.deepStrictEqual(requirements.find((r) => r.id === 'FRD-42').acceptance, []);
});

test('an acceptance entry whose requirement is absent is reported, not dropped', () => {
  const { warnings } = adoptRequirements([
    { id: 'FRD-99', text: 'orphan criterion', section: '5. EPIC 9 / FR-9.9 AC' },
    ...WITH_AC,
  ]);
  assert.ok(warnings.some((w) => /FR-9\.9/.test(w)),
    'an acceptance criterion with no requirement is an untraceable postcondition');
});

test('an empty spine fails loudly instead of adopting nothing', () => {
  assert.throws(() => adoptRequirements([]), /empty/i,
    'an empty adoption is a vacuous pass, not a valid BRD');
});

test('duplicate source ids are refused rather than silently collapsed', () => {
  assert.throws(
    () => adoptRequirements([FRD[0], { ...FRD[0], text: 'different' }]),
    /duplicate/i,
  );
});

test('a source requirement with no id is reported, not skipped', () => {
  const { warnings } = adoptRequirements([...FRD, { text: 'orphan', section: '3. Functional Requirements' }]);
  assert.ok(warnings.some((w) => /no id/i.test(w)),
    'an unidentified requirement cannot be traced and must be surfaced');
});
