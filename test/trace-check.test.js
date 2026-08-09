'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'trace-check.js');
const { checkTraces } = require(SCRIPT);

// The generic groundedness engine: given `required` upstream items (all must be
// covered), `optional` upstream items (valid trace targets, not required to be
// covered), and `downstream` items (each with a `traces` array), report:
//   net_new — downstream items tracing to nothing valid (invented)
//   dropped — required upstream items no downstream item traces to (lost)

const stories = [
  { id: 'E1-S1', text: 'Reset password', traces: ['BR-1'] },
  { id: 'E1-S2', text: 'Order history', traces: ['BR-2'] },
];
const brs = [
  { id: 'BR-1', text: 'Password reset' },
  { id: 'BR-2', text: 'Order history' },
];

test('passes when every downstream item traces to a required id and every required id is covered', () => {
  const v = checkTraces({ required: brs, downstream: stories });
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.net_new, []);
  assert.deepStrictEqual(v.dropped, []);
  assert.strictEqual(v.required_total, 2);
  assert.strictEqual(v.required_covered, 2);
});

test('flags a downstream item tracing to nothing as net-new', () => {
  const v = checkTraces({ required: brs, downstream: [...stories, { id: 'E1-S3', text: 'invented', traces: [] }] });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.net_new.map((r) => r.id), ['E1-S3']);
});

test('flags a downstream item tracing to a non-existent id as net-new', () => {
  const v = checkTraces({ required: brs, downstream: [{ id: 'E1-S1', traces: ['BR-99'] }, { id: 'E1-S2', traces: ['BR-2'] }] });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.net_new.map((r) => r.id), ['E1-S1']);
});

test('flags a required id no downstream item covers as dropped', () => {
  const v = checkTraces({ required: brs, downstream: [{ id: 'E1-S1', traces: ['BR-1'] }] });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.dropped.map((r) => r.id), ['BR-2']);
});

test('optional upstream ids are valid trace targets but not required to be covered', () => {
  const optional = [{ id: 'C1', text: 'clarification' }];
  const ds = [
    { id: 'E1-S1', traces: ['BR-1'] },
    { id: 'E1-S2', traces: ['BR-2'] },
    { id: 'E1-S3', traces: ['C1'] }, // grounded by an optional id — not net-new
  ];
  const v = checkTraces({ required: brs, optional, downstream: ds });
  assert.strictEqual(v.pass, true);
  // required_covered counts only required ids, not the optional C1
  assert.strictEqual(v.required_covered, 2);
});

test('reports net-new and dropped together', () => {
  const v = checkTraces({ required: brs, downstream: [{ id: 'E1-S1', traces: ['BR-1'] }, { id: 'E1-S2', traces: [] }] });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.net_new.length, 1); // E1-S2
  assert.strictEqual(v.dropped.length, 1); // BR-2
});

test('a missing traces field counts as net-new (never silently grounded)', () => {
  const v = checkTraces({ required: brs, downstream: [{ id: 'E1-S1', traces: ['BR-1'] }, { id: 'E1-S2' }] });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.dropped.length, 1); // BR-2 uncovered (E1-S2 has no valid trace)
  assert.deepStrictEqual(v.net_new.map((r) => r.id), ['E1-S2']);
});

// --- CLI ----------------------------------------------------------------------

function writeJson(dir, name, data) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

test('CLI: --required + --downstream, writes verdict, exit 0 on pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const out = path.join(dir, 'verdict.json');
  execFileSync(process.execPath, [SCRIPT,
    '--required', writeJson(dir, 'br.json', brs),
    '--downstream', writeJson(dir, 'stories.json', stories),
    '--layer', 'spec',
    '--out', out]);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.layer, 'spec');
});

test('CLI: exits non-zero on a trace violation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const out = path.join(dir, 'verdict.json');
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT,
      '--required', writeJson(dir, 'br.json', brs),
      '--downstream', writeJson(dir, 'stories.json', [{ id: 'E1-S1', traces: [] }]),
      '--out', out], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, false);
});

test('CLI: accepts multiple --required files (union of upstream ids)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const out = path.join(dir, 'verdict.json');
  execFileSync(process.execPath, [SCRIPT,
    '--required', writeJson(dir, 'a.json', [{ id: 'BR-1' }]),
    '--required', writeJson(dir, 'b.json', [{ id: 'BR-2' }]),
    '--downstream', writeJson(dir, 'd.json', [{ id: 'X', traces: ['BR-1'] }, { id: 'Y', traces: ['BR-2'] }]),
    '--out', out]);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, true);
});

// --- wiring consistency: spec layer threads the trace spine + gate ---

const fsw = require('fs');
const pathw = require('path');
const ROOTW = pathw.join(__dirname, '..');

test('/spec emits story-traces.json and runs the deterministic grounding gate', () => {
  const spec = require('./helpers/skill-corpus').readSkillCorpus('spec');
  assert.match(spec, /story-traces\.json/);
  assert.match(spec, /trace-check\.js/);
  assert.match(spec, /spec-grounding\.json/);
  assert.match(spec, /HARD BLOCK/);
});

test('rubric spec phase hard-gates on spec-grounding.json', () => {
  const rubric = JSON.parse(fsw.readFileSync(pathw.join(ROOTW, '.claude', 'templates', 'phase-eval-rubrics.json'), 'utf8'));
  assert.match(rubric.phases.spec.hard_gate, /spec-grounding\.json/);
  assert.match(rubric.phases.spec.hard_gate, /net_new/);
});

test('evaluator treats a {phase}-grounding.json verdict as a hard gate', () => {
  const ev = fsw.readFileSync(pathw.join(ROOTW, '.claude', 'agents', 'evaluator.md'), 'utf8');
  assert.match(ev, /\{phase\}-grounding\.json/);
  assert.match(ev, /spec-grounding\.json/);
});

test('/design and /test thread their trace spine + grounding gate', () => {
  // Phase 4 progressive loading moved design's trace-spine procedure into references/.
  const design = readSkillCorpus('design');
  assert.match(design, /design-traces\.json/);
  assert.match(design, /trace-check\.js/);
  assert.match(design, /design-grounding\.json/);
  assert.match(design, /HARD BLOCK/);
  const tst = fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'test', 'SKILL.md'), 'utf8');
  assert.match(tst, /test-traces\.json/);
  assert.match(tst, /trace-check\.js/);
  assert.match(tst, /test-grounding\.json/);
  assert.match(tst, /HARD BLOCK/);
});

test('rubric now has a test phase, and design/test phases hard-gate on grounding', () => {
  const rubric = JSON.parse(fsw.readFileSync(pathw.join(ROOTW, '.claude', 'templates', 'phase-eval-rubrics.json'), 'utf8'));
  assert.ok(rubric.phases.test, 'test phase must exist');
  assert.match(rubric.phases.test.hard_gate, /test-grounding\.json/);
  assert.match(rubric.phases.design.hard_gate, /design-grounding\.json/);
});

test('verification matrix gate is wired through test, auto, generator, evaluator, and evaluate prompts', () => {
  const files = {
    testSkill: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'test', 'SKILL.md'), 'utf8'),
    // Phase 4 progressive loading moved auto's verification-matrix wiring into references/.
    autoSkill: readSkillCorpus('auto'),
    generator: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'agents', 'generator.md'), 'utf8'),
    evaluator: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'agents', 'evaluator.md'), 'utf8'),
    evaluateSkill: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'evaluate', 'SKILL.md'), 'utf8'),
  };

  assert.match(files.testSkill, /verification-matrix\.json/);
  assert.match(files.testSkill, /verification-matrix-gate\.js --phase plan/);
  assert.match(files.testSkill, /unit-traces\.json/);
  assert.match(files.testSkill, /integration-traces\.json/);
  assert.match(files.testSkill, /e2e-traces\.json/);
  assert.match(files.testSkill, /implementation_paths/);
  assert.match(files.testSkill, /HARD (?:BLOCK|gate)[\s\S]*verification-matrix-verdict\.json/);
  assert.match(files.testSkill, /generate[\s\S]*unit-traces\.json[\s\S]*integration-traces\.json[\s\S]*e2e-traces\.json/);

  assert.match(files.autoSkill, /verification-matrix\.json/);
  assert.match(files.autoSkill, /verification-matrix-gate\.js --phase contract/);
  assert.match(files.autoSkill, /verification-matrix-gate\.js --phase implementation/);
  assert.match(files.autoSkill, /verification-matrix-gate\.js --phase executed --group "\$GROUP_ID"/);

  assert.match(files.generator, /unit-traces\.json/);
  assert.match(files.generator, /matrix_id/);
  assert.match(files.generator, /implementation_paths/);
  assert.match(files.evaluator, /matrix_ids/);
  assert.match(files.evaluator, /implementation_paths/);
  assert.match(files.evaluateSkill, /matrix_ids/);
  assert.match(files.evaluateSkill, /implementation_paths/);
  assert.match(files.evaluateSkill, /Submit button not clickable.*matrix_ids/);
  assert.match(files.evaluateSkill, /Success message visible after form submit.*matrix_ids/);
});

// --- milestone scoping --------------------------------------------------------
//
// /spec's D1 routinely scopes a run to ONE milestone: it expands that
// milestone's requirements to story depth and leaves the rest at epic
// granularity. Run unscoped against a milestone-scoped story set, this gate
// reports every deferred requirement as `dropped` and can never pass — so the
// only supported route was to re-run /brd, or to hand-build a narrowed
// `--required` file. A live run took the second option: the renderer fabricated
// `m1-requirements-in-scope.json`, the gate went green on inputs the renderer
// invented, and nothing recorded that 18 of 24 requirements were never checked.
//
// `--scope` makes the narrowing declared, deterministic, and visible in the
// verdict instead of improvised.

const { applyScope } = require(SCRIPT);

const allReqs = [
  { id: 'FR-1', text: 'sign in' },
  { id: 'FR-2', text: 'create link' },
  { id: 'FR-4', text: 'list links' },
  { id: 'NFR-2', text: 'list page latency' },
];
const m1Stories = [
  { id: 'E1-S1', text: 'sign in', traces: ['FR-1'] },
  { id: 'E2-S1', text: 'create link', traces: ['FR-2'] },
];

test('scope narrows required to the in-scope ids and defers the rest to optional', () => {
  const scoped = applyScope({
    required: allReqs,
    optional: [],
    scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2'] } },
    source: 'specs/decisions/spec-decisions.json',
  });
  assert.deepStrictEqual(scoped.required.map((r) => r.id), ['FR-1', 'FR-2']);
  assert.deepStrictEqual(scoped.optional.map((r) => r.id), ['FR-4', 'NFR-2']);
});

test('a milestone-scoped story set passes the gate under --scope and fails without it', () => {
  const unscoped = checkTraces({ required: allReqs, downstream: m1Stories });
  assert.strictEqual(unscoped.pass, false);
  assert.deepStrictEqual(unscoped.dropped.map((d) => d.id), ['FR-4', 'NFR-2']);

  const s = applyScope({
    required: allReqs,
    optional: [],
    scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2'] } },
    source: 'specs/decisions/spec-decisions.json',
  });
  const v = checkTraces({ required: s.required, optional: s.optional, downstream: m1Stories, scope: s.scope });
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.required_covered, 2);
});

// A narrowed gate that does not say what it stopped checking reads as full
// coverage. The deferred ids travel in the verdict so the human review and the
// next /spec run can both see them.
test('the verdict records what the scope deferred, by id', () => {
  const s = applyScope({
    required: allReqs,
    optional: [],
    scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2'] } },
    source: 'specs/decisions/spec-decisions.json',
  });
  const v = checkTraces({ required: s.required, optional: s.optional, downstream: m1Stories, scope: s.scope });
  assert.strictEqual(v.scope.milestone, 'M1');
  assert.strictEqual(v.scope.source, 'specs/decisions/spec-decisions.json');
  assert.strictEqual(v.scope.in_scope, 2);
  assert.deepStrictEqual(v.scope.deferred_ids, ['FR-4', 'NFR-2']);
});

test('an unscoped verdict carries scope: null rather than omitting the field', () => {
  const v = checkTraces({ required: allReqs, downstream: m1Stories });
  assert.strictEqual(v.scope, null);
});

// The vacuous-pass guards. Each of these would otherwise turn a hard gate into
// a no-op that reports PASS.
test('a scope naming no requirement is an error, not an empty-and-passing gate', () => {
  assert.throws(
    () => applyScope({
      required: allReqs,
      optional: [],
      scope: { milestone: { name: 'M1', requirements_in_scope: [] } },
      source: 'd.json',
    }),
    /requirements_in_scope is empty/
  );
});

test('a scope file with no milestone block is an error', () => {
  assert.throws(
    () => applyScope({ required: allReqs, optional: [], scope: { decisions: [] }, source: 'd.json' }),
    /no milestone\.requirements_in_scope/
  );
});

// A scope id matching no record is reported rather than thrown: against
// brd-requirements.json it means a stale decisions file, but against
// brd-acceptance.json it is the ordinary case of a requirement carrying no
// postcondition. Throwing would block the acceptance gate for doing its job, so
// the id travels in the verdict instead — visible either way, never silent.
test('a scope id matching no record is reported as unmatched, not thrown', () => {
  const s = applyScope({
    required: allReqs,
    optional: [],
    scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-99'] } },
    source: 'd.json',
  });
  assert.deepStrictEqual(s.scope.unmatched_ids, ['FR-99']);
  assert.deepStrictEqual(s.required.map((r) => r.id), ['FR-1']);
});

test('a scope matching NOTHING still throws — an empty required set passes vacuously', () => {
  assert.throws(
    () => applyScope({
      required: allReqs,
      optional: [],
      scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-98', 'FR-99'] } },
      source: 'd.json',
    }),
    /matches no record/
  );
});

test('unmatched ids print, so a stale decisions file cannot pass unnoticed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-unmatched-'));
  const w = (name, data) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(data));
    return p;
  };
  const stdout = execFileSync('node', [
    SCRIPT,
    '--required', w('required.json', allReqs),
    '--downstream', w('downstream.json', m1Stories),
    '--scope', w('scope.json', { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2', 'FR-99'] } }),
  ], { encoding: 'utf8' });
  assert.match(stdout, /UNMATCHED \(in scope, no record in --required\): FR-99/);
});

test('--scope end to end: narrows the run and writes the deferral into the verdict file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-scope-'));
  const w = (name, data) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(data));
    return p;
  };
  const required = w('required.json', allReqs);
  const downstream = w('downstream.json', m1Stories);
  const scope = w('spec-decisions.json', { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2'] } });
  const out = path.join(dir, 'verdict.json');

  const stdout = execFileSync('node', [
    SCRIPT, '--required', required, '--downstream', downstream,
    '--scope', scope, '--layer', 'spec', '--out', out,
  ], { encoding: 'utf8' });

  assert.match(stdout, /PASS/);
  assert.match(stdout, /scoped to M1/);
  assert.match(stdout, /2 deferred/);
  const verdict = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(verdict.pass, true);
  assert.deepStrictEqual(verdict.scope.deferred_ids, ['FR-4', 'NFR-2']);
});

test('--scope pointed at a file with an empty in-scope list exits 2, not 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-scope-bad-'));
  const w = (name, data) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(data));
    return p;
  };
  const required = w('required.json', allReqs);
  const downstream = w('downstream.json', m1Stories);
  const scope = w('spec-decisions.json', { milestone: { name: 'M1', requirements_in_scope: [] } });

  assert.throws(
    () => execFileSync('node', [SCRIPT, '--required', required, '--downstream', downstream, '--scope', scope], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => err.status === 2
  );
});

// Step 6.46 scopes acceptance criteria with the SAME decisions file, but
// brd-acceptance.json keys on `FR-1-AC` and carries the requirement it gates in
// a `requirement` field. Matching on `id` alone rejects every one of them, so
// the milestone addendum for 6.46 would have been inert on arrival.
const m1Acceptance = [
  { id: 'FR-1-AC', requirement: 'FR-1', text: 'signing in sets a cookie' },
  { id: 'FR-2-AC', requirement: 'FR-2', text: 'creating returns 201' },
  { id: 'FR-4-AC', requirement: 'FR-4', text: 'page 1 returns 20 links' },
];

test('scope matches acceptance items by the requirement they gate, not only by id', () => {
  const s = applyScope({
    required: m1Acceptance,
    optional: [],
    scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2'] } },
    source: 'specs/decisions/spec-decisions.json',
  });
  assert.deepStrictEqual(s.required.map((r) => r.id), ['FR-1-AC', 'FR-2-AC']);
  assert.deepStrictEqual(s.scope.deferred_ids, ['FR-4-AC']);
});

// The shortlink BRD reaches /spec with seven requirements carrying no
// postcondition. Scoping the acceptance gate by the milestone therefore always
// names ids absent from brd-acceptance.json — the un-oracled-NFR condition the
// BRD already tracks, not a broken scope. It must be named, and must not block.
test('a requirement with no acceptance record is reported, and the rest still gate', () => {
  const s = applyScope({
    required: m1Acceptance,
    optional: [],
    scope: { milestone: { name: 'M1', requirements_in_scope: ['FR-1', 'FR-2', 'NFR-3'] } },
    source: 'd.json',
  });
  assert.deepStrictEqual(s.required.map((r) => r.id), ['FR-1-AC', 'FR-2-AC']);
  assert.deepStrictEqual(s.scope.unmatched_ids, ['NFR-3'],
    'the requirement with no oracle must be named, not silently dropped');
});
