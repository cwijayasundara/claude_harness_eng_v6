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

// A PRD's narrative sections are extracted into the same spine as its
// requirements. Adopted as requirements, an open question becomes something to
// build: on the real 149-entry spine, 36 of 133 "requirements" were Assumptions,
// Problem, Goals, Users, Scope, Milestones, Risks and Open questions — including
// "Open question — how much front-end?", which would then need a story, a
// taxonomy slot and test coverage.
const NARRATIVE = [
  { id: 'FRD-1', text: 'v1 is built part-time by one person.', section: '0. Assumptions' },
  { id: 'FRD-2', text: 'Analysts cannot triage a corpus.', section: '1. Problem' },
  { id: 'FRD-3', text: 'Ship a ranked list.', section: '2. Goals' },
  { id: 'FRD-4', text: 'Engagement analysts.', section: '3. Users' },
  { id: 'FRD-5', text: 'P3 is the gate that matters.', section: '10. Milestones' },
  { id: 'FRD-6', text: 'Neo4j may not scale.', section: '11. Risks' },
  { id: 'FRD-7', text: 'How much front-end?', section: '12. Open questions' },
  { id: 'FRD-8', text: 'MUST accept an .xlsx upload.', section: '5. EPIC 1 / FR-1.1' },
];

test('narrative sections are not adopted as requirements', () => {
  const { requirements } = adoptRequirements(NARRATIVE);
  assert.deepStrictEqual(requirements.map((r) => r.id), ['FRD-8'],
    'only requirement-bearing sections become requirements');
});

test('narrative content is classified, never silently dropped', () => {
  const res = adoptRequirements(NARRATIVE);
  const accounted = new Set([
    ...res.requirements.map((r) => r.id),
    ...res.context.map((c) => c.id),
    ...res.open_questions.map((q) => q.id),
    ...res.risks.map((r) => r.id),
  ]);
  for (const entry of NARRATIVE) {
    assert.ok(accounted.has(entry.id), `${entry.id} was neither adopted nor classified`);
  }
});

test('open questions and risks are separated so they can feed clarification', () => {
  const res = adoptRequirements(NARRATIVE);
  assert.deepStrictEqual(res.open_questions.map((q) => q.id), ['FRD-7']);
  assert.deepStrictEqual(res.risks.map((r) => r.id), ['FRD-6']);
});

test('Non-goals still become safeguards, not narrative context', () => {
  const withNonGoals = [...NARRATIVE, { id: 'FRD-9', text: 'No mobile client.', section: '2. Non-goals' }];
  const res = adoptRequirements(withNonGoals);
  assert.ok(!res.context.some((c) => c.id === 'FRD-9'), 'a non-goal is a deny-list entry, not prose');
  assert.deepStrictEqual(adoptSafeguards(withNonGoals).map((s) => s.traces[0]), ['FRD-9']);
});

test('an acceptance criterion attaches to EVERY spine entry of its requirement', () => {
  // The extractor splits one PRD requirement across several spine entries (FR-0.1
  // had four). Attaching the AC to only the first leaves the rest oracle-less —
  // manufacturing downstream the exact defect validate-prd.js exists to block.
  const split = [
    { id: 'FRD-10', text: 'MUST generate a corpus.', section: '5. EPIC 0 / FR-0.1' },
    { id: 'FRD-11', text: 'MUST be seeded.', section: '5. EPIC 0 / FR-0.1' },
    { id: 'FRD-12', text: 'AC text here.', section: '5. EPIC 0 / FR-0.1 AC' },
  ];
  const { requirements } = adoptRequirements(split);
  assert.deepStrictEqual(requirements.map((r) => r.acceptance), [['FRD-12'], ['FRD-12']],
    'both entries of FR-0.1 carry its acceptance criterion');
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '.claude', 'scripts', 'brd-adopt.js');

function runAdopt(spine, args = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brd-adopt-cli-'));
  fs.mkdirSync(path.join(root, 'specs', 'brd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'brd', 'frd-requirements.json'), JSON.stringify(spine));
  execFileSync('node', [CLI, '--root', root, ...args], { encoding: 'utf8' });
  return root;
}

const MIXED = [
  { id: 'FRD-1', text: 'MUST accept an upload.', section: '5. EPIC 1 / FR-1.1' },
  { id: 'FRD-2', text: 'How much front-end?', section: '12. Open questions' },
  { id: 'FRD-3', text: 'Neo4j may not scale.', section: '11. Risks' },
  { id: 'FRD-4', text: 'Solo part-time build.', section: '0. Assumptions' },
  { id: 'FRD-5', text: 'No mobile client.', section: '2. Non-goals' },
];

// Classifying in memory and writing only the requirements makes the Step 4.4
// grounding gate report every classified entry as `dropped` — measured at 52 of
// 149 on the real spine, a HARD BLOCK failure. Its documented remedy ("add a BR
// entry covering it") would reinstate exactly what the classification removed.
test('every classified entry is persisted, not just the requirements', () => {
  const root = runAdopt(MIXED);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'specs', 'brd', f), 'utf8'));
  assert.deepStrictEqual(read('brd-open-questions.json').map((e) => e.id), ['FRD-2']);
  assert.deepStrictEqual(read('brd-risks.json').map((e) => e.id), ['FRD-3']);
  assert.deepStrictEqual(read('brd-context.json').map((e) => e.id), ['FRD-4']);
});

test('the adoption manifest accounts for every source id, so grounding stays an identity', () => {
  const root = runAdopt(MIXED);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'brd', 'brd-adoption.json'), 'utf8'));
  assert.deepStrictEqual(manifest.map((e) => e.id).sort(), MIXED.map((e) => e.id).sort());
  for (const entry of manifest) {
    assert.deepStrictEqual(entry.traces, [entry.id], `${entry.id} must trace to its own source id`);
    assert.ok(entry.kind, `${entry.id} must record how it was classified`);
  }
});

// Delta mode needs the outputs under specs/brd/sprint-N/. --root cannot express
// that: it prefixes specs/brd/ again, so the files land two levels deep where
// Step D2's trace-check never reads them.
test('--out-dir places every output where delta mode reads it', () => {
  const root = runAdopt(MIXED, ['--out-dir', 'specs/brd/sprint-2']);
  const dir = path.join(root, 'specs', 'brd', 'sprint-2');
  for (const f of ['brd-requirements.json', 'brd-acceptance.json', 'brd-safeguards.json', 'brd-adoption.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} must be written to --out-dir`);
  }
  assert.ok(!fs.existsSync(path.join(root, 'specs', 'brd', 'brd-requirements.json')),
    'the flat sprint-1 spine must not be overwritten');
});

// path.join(root, outDir) silently relativises an absolute --out-dir: files for
// `--out-dir /tmp/x` landed at `<root>/tmp/x`, somewhere the caller never looks.
test('an absolute --out-dir is honoured, not reparented under root', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'brd-adopt-abs-'));
  const root = runAdopt(MIXED, ['--out-dir', target]);
  assert.ok(fs.existsSync(path.join(target, 'brd-requirements.json')),
    'an absolute out-dir must receive the files');
  assert.ok(!fs.existsSync(path.join(root, target)),
    'and must not be reparented under root');
});

// R4 link 1: the PRD's milestone plan reaches /spec as data. /brd Step 0.0
// already copies the PRD verbatim to specs/brd/source-frd.md, so adoption can
// emit the plan without introducing a second source of truth.
test('the milestone plan is emitted from the PRD copy when one exists', () => {
  const root = runAdopt(MIXED);
  fs.writeFileSync(path.join(root, 'specs', 'brd', 'source-frd.md'),
    '# PRD\n\n## 7. Milestones\n- **M1 — Ingest** (FR-1.1). Done when: a workbook lists in the browser.\n');
  execFileSync('node', [CLI, '--root', root], { encoding: 'utf8' });
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'brd', 'brd-milestones.json'), 'utf8'));
  assert.deepStrictEqual(plan.map((m) => m.id), ['M1']);
  assert.deepStrictEqual(plan[0].requirements, ['FR-1.1']);
  assert.strictEqual(plan[0].observable, true);
});

test('no PRD copy means an empty plan, not a crash', () => {
  const root = runAdopt(MIXED);
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'specs', 'brd', 'brd-milestones.json'), 'utf8'));
  assert.deepStrictEqual(plan, [], 'interview mode has no PRD and therefore no milestone plan');
});

// Adoption's classified buckets are only worth writing if something consumes
// them. brd-context.json already feeds the Forbidden Actions deny-list; these
// two were written and read by nobody.
test('every classified bucket has a documented consumer', () => {
  const brd = fs.readFileSync(path.join(__dirname, '..', '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8');
  const render = fs.readFileSync(path.join(__dirname, '..', '.claude', 'skills', 'brd-render', 'SKILL.md'), 'utf8');
  const corpus = `${brd}\n${render}`;
  for (const bucket of ['brd-open-questions.json', 'brd-risks.json', 'brd-context.json']) {
    assert.match(corpus, new RegExp(bucket.replace('.', '\\.')),
      `${bucket} is written by adoption but nothing reads it`);
  }
});

test("the PRD's own open questions lead the clarification budget", () => {
  // The audited run: the PRD stated five open questions, the clarification log
  // recorded six entries the planner had written both sides of, and the
  // document's actual unknowns were never systematically asked.
  const brd = fs.readFileSync(path.join(__dirname, '..', '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8');
  const idx = brd.indexOf('### Step 0.5');
  const step = brd.slice(idx, idx + 1600);
  assert.match(step, /brd-open-questions\.json/, 'the budget must start from the PRD, not from invention');
  assert.match(step, /Open Questions section/i, 'an unresolved one must stay visible, not be dropped');
});

// Delta mode: /brd instructs `--source <sprint-N>/frd-requirements.json
// --out-dir specs/brd/sprint-N`. SOURCE_PRD was hardcoded flat, so sprint N's
// milestone plan was parsed from sprint 1's PRD — and /spec is then told that
// file is "the build sequence the human already decided… do not silently depart
// from it."
test('the milestone plan comes from the PRD beside the spine being adopted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brd-adopt-delta-'));
  const sprint = path.join(root, 'specs', 'brd', 'sprint-2');
  fs.mkdirSync(sprint, { recursive: true });
  // Sprint 1's flat PRD — must NOT be the source for sprint 2.
  fs.mkdirSync(path.join(root, 'specs', 'brd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'brd', 'source-frd.md'),
    '## 7. Milestones\n- **M1 — SPRINT-ONE** (FR-1). Done when: sprint one shipped.\n');
  fs.writeFileSync(path.join(sprint, 'frd-requirements.json'),
    JSON.stringify([{ id: 'FRD-9', text: 'sprint two req', section: '5. EPIC 1 / FR-9.1' }]));
  fs.writeFileSync(path.join(sprint, 'source-frd.md'),
    '## 7. Milestones\n- **M2 — SPRINT-TWO** (FR-9.1). Done when: sprint two ships.\n');

  execFileSync('node', [CLI, '--root', root,
    '--source', path.join(sprint, 'frd-requirements.json'),
    '--out-dir', 'specs/brd/sprint-2'], { encoding: 'utf8' });

  const plan = JSON.parse(fs.readFileSync(path.join(sprint, 'brd-milestones.json'), 'utf8'));
  assert.deepStrictEqual(plan.map((m) => m.id), ['M2'],
    "sprint 2 must read its own PRD, not the previous sprint's");
});

// --- the PRD label ------------------------------------------------------------
//
// The BRD carried two id spaces with no machine-readable join. Requirements were
// keyed on the extractor's spine id (FRD-1) with the PRD's own identifier
// surviving only inside the free-text `section` ("4. Functional … / FR-1"),
// while brd-milestones.json#requirements and brd-acceptance.json#requirement
// both key on that identifier (FR-1).
//
// The adopter already resolved the identifier internally to link acceptance —
// it simply never wrote it down. So every consumer that needed to join the two
// spaces had to re-parse the section prose, and a live /spec run instead
// hand-built a mapping file and passed a hard gate against it.

const LABELLED = [
  { id: 'FRD-1', text: 'Register and sign in.', section: '4. Functional Requirements / FR-1' },
  { id: 'FRD-2', text: 'Create a short link.', section: '4. Functional Requirements / FR-2' },
  { id: 'FRD-3', text: 'p95 under 50ms.', section: '5. Non-Functional Requirements / NFR-1' },
];

test('an adopted requirement carries the PRD identifier as a field, not only in prose', () => {
  const { requirements } = adoptRequirements(LABELLED);
  assert.deepStrictEqual(requirements.map((r) => r.label), ['FR-1', 'FR-2', 'NFR-1']);
});

test('the label is what milestones and acceptance already key on', () => {
  const { requirements } = adoptRequirements(LABELLED);
  const acceptance = adoptAcceptance([
    ...LABELLED,
    { id: 'FRD-4', text: 'Given …, then 201.', section: '6. Acceptance / FR-2 AC' },
  ]);
  const gated = acceptance[0];
  assert.strictEqual(gated.requirement, 'FR-2');
  assert.ok(requirements.some((r) => r.label === gated.requirement),
    'the acceptance link must resolve against a requirement field, not a parsed section');
});

// A plain section heading carries no per-requirement identifier. Inventing one
// would be worse than none: downstream would join on a label nobody wrote.
test('a requirement whose section names no identifier gets label null', () => {
  const { requirements } = adoptRequirements(FRD);
  assert.ok(requirements.every((r) => r.label === null));
});

test('the spine id is still the id — the label is additive, not a rename', () => {
  const { requirements } = adoptRequirements(LABELLED);
  assert.deepStrictEqual(requirements.map((r) => r.id), ['FRD-1', 'FRD-2', 'FRD-3']);
  assert.deepStrictEqual(requirements.map((r) => r.traces), [['FRD-1'], ['FRD-2'], ['FRD-3']]);
});

// --- the adopted spine must survive the render --------------------------------
//
// brd-render is told in plain words to leave `id` and `text` untouched in
// --prd/--frd mode, and its own SKILL admits "neither hard gate can catch it"
// if it does not: an adopted spine passes the grounding gate as an identity,
// and a re-keyed spine that still carries `traces` passes it as coverage.
//
// A live run re-keyed all 24 requirements from the spine ids to the PRD labels.
// Nothing noticed, and the result was that two runs of the same pipeline emitted
// brd-requirements.json in two different id spaces. --verify re-derives the
// spine from the immutable source and compares, so the rule is checkable rather
// than merely stated.

const LABELLED_CLI = [
  { id: 'FRD-1', text: 'Register and sign in.', section: '4. Functional Requirements / FR-1' },
  { id: 'FRD-2', text: 'Create a short link.', section: '4. Functional Requirements / FR-2' },
];

function verify(root, args = []) {
  try {
    const stdout = execFileSync('node', [CLI, '--root', root, '--verify', ...args], { encoding: 'utf8' });
    return { status: 0, out: stdout };
  } catch (err) {
    return { status: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const reqPath = (root) => path.join(root, 'specs', 'brd', 'brd-requirements.json');
const readReq = (root) => JSON.parse(fs.readFileSync(reqPath(root), 'utf8'));
const writeReq = (root, data) => fs.writeFileSync(reqPath(root), JSON.stringify(data, null, 1));

test('--verify passes on a freshly adopted spine', () => {
  const r = verify(runAdopt(LABELLED_CLI));
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /OK/);
});

// What brd-render is SUPPOSED to do: fill taxonomy, leave id and text alone.
test('--verify passes after the renderer fills the taxonomy slots', () => {
  const root = runAdopt(LABELLED_CLI);
  writeReq(root, readReq(root).map((r) => ({ ...r, taxonomy: ['functional'] })));
  const r = verify(root);
  assert.strictEqual(r.status, 0, r.out);
});

// The live failure, now catchable.
test('--verify fails when the renderer re-keys the spine to the PRD labels', () => {
  const root = runAdopt(LABELLED_CLI);
  writeReq(root, readReq(root).map((r) => ({ ...r, id: r.label, traces: [r.label] })));
  const r = verify(root);
  assert.strictEqual(r.status, 1);
  assert.match(r.out, /FRD-1/);
});

test('--verify fails when a requirement is dropped or invented', () => {
  const dropped = runAdopt(LABELLED_CLI);
  writeReq(dropped, readReq(dropped).slice(1));
  assert.strictEqual(verify(dropped).status, 1);

  const invented = runAdopt(LABELLED_CLI);
  writeReq(invented, [...readReq(invented), { id: 'FRD-99', text: 'invented', label: null, traces: ['FRD-99'] }]);
  const r = verify(invented);
  assert.strictEqual(r.status, 1);
  assert.match(r.out, /FRD-99/);
});

// The paraphrase R2 exists to remove. Re-wording is exactly as undetectable as
// re-keying was, and just as much a silent change to the immutable baseline.
test('--verify fails when a requirement is silently re-worded', () => {
  const root = runAdopt(LABELLED_CLI);
  writeReq(root, readReq(root).map((r, i) => (i ? r : { ...r, text: 'Register, sign in, and reset a password.' })));
  const r = verify(root);
  assert.strictEqual(r.status, 1);
  assert.match(r.out, /text/i);
});

test('--verify fails loudly when there is nothing to verify against', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brd-verify-none-'));
  fs.mkdirSync(path.join(root, 'specs', 'brd'), { recursive: true });
  const r = verify(root);
  assert.strictEqual(r.status, 2, 'a missing source must not read as a clean bill of health');
});

test('--verify honours --out-dir, so delta sprints are checkable too', () => {
  const root = runAdopt(LABELLED_CLI, ['--out-dir', 'specs/brd/sprint-2']);
  assert.strictEqual(verify(root, ['--out-dir', 'specs/brd/sprint-2']).status, 0);
});
