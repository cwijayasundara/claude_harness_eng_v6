'use strict';

// The mid-sized pipeline fixture, round-tripped through the REAL validators.
//
// docs/shortlink-prd.md exists to exercise the whole pipeline in one sitting.
// That only works if it stays structurally clean, so this asserts against
// validate-prd.js and brd-adopt.js themselves rather than a hand-built fixture:
// if either gate changes its conventions, this fails and the fixture gets fixed
// with it.
//
// It also pins the section conventions brd-extract documents. brd-adopt routes
// by section label, not by content — a postcondition labelled anything other
// than "<id> AC" is adopted as a REQUIREMENT, which inflates the spine and
// leaves the real requirement with no oracle. That failure is silent: every
// count still looks plausible.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRD = path.join(ROOT, 'docs/shortlink-prd.md');

/** Build the spine the way brd-extract's section table instructs. */
function extractSpine(markdown) {
  const out = [];
  let section = null;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) { section = heading[1].trim(); continue; }
    if (!section) continue;
    const ac = line.match(/^-\s+\*\*((?:FR|NFR)-[\w.]+)\*\*\s+(?:→|->)\s+(.*)$/);
    if (ac && /Acceptance/i.test(section)) {
      out.push({ id: `FRD-${out.length + 1}`, text: ac[2], section: `${section} / ${ac[1]} AC` });
      continue;
    }
    const req = line.match(/^-\s+\*\*((?:FR|NFR)-[\w.]+)\*\*\s+(.*)$/);
    if (req) {
      out.push({ id: `FRD-${out.length + 1}`, text: req[2], section: `${section} / ${req[1]}` });
      continue;
    }
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet && /Out of Scope|Risks|Open Questions|Milestones/i.test(section)) {
      out.push({ id: `FRD-${out.length + 1}`, text: bullet[1], section });
    }
  }
  return out;
}

function adopt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlink-'));
  fs.mkdirSync(path.join(dir, 'specs/brd'), { recursive: true });
  const markdown = fs.readFileSync(PRD, 'utf8');
  fs.writeFileSync(path.join(dir, 'specs/brd/source-frd.md'), markdown);
  fs.writeFileSync(
    path.join(dir, 'specs/brd/frd-requirements.json'),
    JSON.stringify(extractSpine(markdown), null, 1),
  );
  execFileSync('node', [path.join(ROOT, '.claude/scripts/brd-adopt.js'), '--root', dir]);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'specs/brd', f), 'utf8'));
  return {
    requirements: read('brd-requirements.json'),
    acceptance: read('brd-acceptance.json'),
    safeguards: read('brd-safeguards.json'),
    milestones: read('brd-milestones.json'),
    risks: read('brd-risks.json'),
    openQuestions: read('brd-open-questions.json'),
  };
}

test('the fixture passes the PRD shape gate clean — no errors, no warnings', () => {
  // A fixture that ships warnings teaches operators to ignore the gate's output,
  // which is how the 35-error PRD reached adoption unexamined.
  const out = execFileSync('node', [path.join(ROOT, '.claude/scripts/validate-prd.js'), PRD])
    .toString();
  assert.match(out, /validate-prd: OK — 24 requirements, 0 warning\(s\)\./);
});

test('adoption routes every section to the artifact that section means', () => {
  const a = adopt();
  assert.strictEqual(a.requirements.length, 24, 'FR-1..FR-16 plus NFR-1..NFR-8');
  assert.strictEqual(a.safeguards.length, 7, 'Out of Scope is a deny-list, not a backlog');
  assert.strictEqual(a.risks.length, 3);
  assert.strictEqual(a.openQuestions.length, 3);
  assert.strictEqual(a.milestones.length, 3);
});

test('acceptance criteria link to their requirement rather than becoming requirements', () => {
  const a = adopt();
  assert.strictEqual(a.acceptance.length, 17, '16 FR postconditions plus NFR-8');
  for (const criterion of a.acceptance) {
    assert.match(criterion.requirement, /^(FR|NFR)-/,
      'a criterion must name the requirement it gates, not a spine id');
  }
  const gated = a.requirements.filter((r) => (r.acceptance || []).length);
  assert.strictEqual(gated.length, 17, 'every criterion must land back on a requirement');
});

test('adoption is verbatim — the spine text survives into the requirements', () => {
  const a = adopt();
  const markdown = fs.readFileSync(PRD, 'utf8');
  for (const req of a.requirements) {
    assert.ok(markdown.includes(req.text),
      `"${req.text.slice(0, 40)}…" was reworded; grounding is only an identity if nothing is transformed`);
  }
});

test('every milestone is observable and names the requirements it closes', () => {
  for (const m of adopt().milestones) {
    assert.strictEqual(m.observable, true, `${m.id} needs a Done when: that can gate a deploy`);
    assert.ok(m.requirements.length > 0,
      `${m.id} names no requirement — /spec cannot propose scope and has to ask`);
  }
});

test('taxonomy is left unassigned for the session that has the human', () => {
  assert.ok(adopt().requirements.every((r) => r.taxonomy === null),
    'slot classification is a judgement; adopting a guess would satisfy the floor with nobody deciding');
});

// --- milestone-scoped grounding, end to end -----------------------------------
//
// The gate `/spec` actually hits, on the artifacts `/brd` actually produces.
// A live run scoped to M1 could not pass Step 6.45 as the skill specified it —
// the 18 requirements M1 defers all read as `dropped` — so the renderer
// hand-built a narrowed `--required` file and the gate went green on inputs it
// had chosen for itself. These assert the supported route instead, against the
// real adopter output rather than a fixture that could encode the wrong shape.

const TRACE_CHECK = path.join(ROOT, '.claude/scripts/trace-check.js');

// The PRD label a requirement carries, as brd-adopt.js records it. The adopter
// keys requirements on the spine id (`FRD-1`) and preserves the label only in
// `section`, while milestones name the label — so this join is what the scope
// has to perform, and what a hand-built in-scope file was standing in for.
const labelOf = (req) => (req.section.match(/\/\s*((?:FR|NFR)-[\w.]+)\s*$/) || [])[1];

function writerInto(dir) {
  return (name, data) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(data, null, 1));
    return p;
  };
}

/** The real BRD artifacts on disk, plus an M1-scoped story set traced to them. */
function m1Workspace() {
  const a = adopt();
  const write = writerInto(fs.mkdtempSync(path.join(os.tmpdir(), 'shortlink-m1-')));
  const m1 = a.milestones.find((m) => /M1/.test(m.id) || /M1/.test(m.name || ''));
  assert.ok(m1, 'the fixture must carry an M1 for this to mean anything');

  const inScope = a.requirements.filter((r) => m1.requirements.includes(labelOf(r)));
  assert.strictEqual(inScope.length, m1.requirements.length,
    'every requirement M1 names must resolve to a requirement record');

  return {
    m1,
    all: a,
    inScope,
    deferred: a.requirements.filter((r) => !m1.requirements.includes(labelOf(r))),
    required: write('brd-requirements.json', a.requirements),
    acceptanceRequired: write('brd-acceptance.json', a.acceptance),
    // One story per in-scope requirement — the shape spec-render emits, traced
    // by the requirement's own id while the scope below names PRD labels.
    storyTraces: write('story-traces.json', inScope.map((r, i) => ({
      id: `E${i}-S1`, text: `story for ${r.id}`, traces: [r.id],
    }))),
    acceptanceCriteria: write('acceptance-criteria.json', a.acceptance
      .filter((c) => m1.requirements.includes(c.requirement))
      .map((c, i) => ({ id: `AC-${i}`, text: c.text, traces: [c.id] }))),
    decisions: write('spec-decisions.json', {
      milestone: { name: m1.name || m1.id, requirements_in_scope: m1.requirements },
    }),
  };
}

const runGate = (args) => {
  try {
    return { status: 0, out: execFileSync('node', [TRACE_CHECK, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, out: String(err.stdout || '') };
  }
};

test('unscoped, a real M1 story set fails Step 6.45 — every deferred requirement reads as dropped', () => {
  const w = m1Workspace();
  const r = runGate(['--required', w.required, '--downstream', w.storyTraces, '--layer', 'spec']);
  assert.strictEqual(r.status, 1, 'this is the failure that pushed a live run into hand-built inputs');
  assert.match(r.out, /FAIL/);
  assert.strictEqual((r.out.match(/DROPPED/g) || []).length, w.deferred.length);
  assert.doesNotMatch(r.out, /NET-NEW/, 'the stories are grounded; only the deferred set is the problem');
});

test('scoped by the real decisions file, the same story set passes and names what it deferred', () => {
  const w = m1Workspace();
  const r = runGate([
    '--required', w.required, '--scope', w.decisions,
    '--downstream', w.storyTraces, '--layer', 'spec',
  ]);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /PASS/);
  assert.match(r.out, /DEFERRED \(not checked here\)/);
  for (const req of w.deferred) {
    assert.ok(r.out.includes(req.id), `${req.id} was deferred silently — the narrowing must be visible`);
  }
});

test('the same decisions file scopes Step 6.46, whose ids are acceptance ids not requirement ids', () => {
  const w = m1Workspace();
  const r = runGate([
    '--required', w.acceptanceRequired, '--scope', w.decisions,
    '--downstream', w.acceptanceCriteria, '--layer', 'spec-acceptance',
  ]);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /PASS/);
});

test('a story tracing to a deferred requirement is not net-new — deferred ids stay valid targets', () => {
  const w = m1Workspace();
  const deferred = w.deferred[0];
  const extra = path.join(path.dirname(w.storyTraces), 'story-traces-extra.json');
  fs.writeFileSync(extra, JSON.stringify([
    ...JSON.parse(fs.readFileSync(w.storyTraces, 'utf8')),
    { id: 'E9-S1', text: 'touches a deferred requirement', traces: [deferred.id] },
  ]));
  const r = runGate(['--required', w.required, '--scope', w.decisions, '--downstream', extra, '--layer', 'spec']);
  assert.strictEqual(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /NET-NEW/);
});

// --- the adopted spine survives the render ------------------------------------
//
// Reproduces the live failure on the real fixture: a run whose renderer re-keyed
// every requirement from the spine id (FRD-n) to the PRD label (FR-n). Both
// existing hard gates passed it — grounding is satisfied by any spine that
// traces — and the result was two runs of the same pipeline emitting
// brd-requirements.json in two different id spaces.

const ADOPT = path.join(ROOT, '.claude/scripts/brd-adopt.js');

/** A real adopted workspace, from the real PRD through the real adopter. */
function adoptedRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlink-adopt-'));
  fs.mkdirSync(path.join(dir, 'specs/brd'), { recursive: true });
  const markdown = fs.readFileSync(PRD, 'utf8');
  fs.writeFileSync(path.join(dir, 'specs/brd/source-frd.md'), markdown);
  fs.writeFileSync(path.join(dir, 'specs/brd/frd-requirements.json'),
    JSON.stringify(extractSpine(markdown), null, 1));
  execFileSync('node', [ADOPT, '--root', dir]);
  return dir;
}

const spinePath = (dir) => path.join(dir, 'specs/brd/brd-requirements.json');
const readSpine = (dir) => JSON.parse(fs.readFileSync(spinePath(dir), 'utf8'));

const verifySpine = (dir) => {
  try {
    return { status: 0, out: execFileSync('node', [ADOPT, '--root', dir, '--verify'], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

test('every adopted requirement carries its PRD label, so the two id spaces join', () => {
  const spine = readSpine(adoptedRoot());
  assert.strictEqual(spine.length, 24);
  for (const req of spine) {
    assert.match(req.label, /^(FR|NFR)-\d+$/,
      `${req.id} has no label; milestones and acceptance key on it`);
  }
  // The join the milestone scope actually performs.
  const milestones = JSON.parse(fs.readFileSync(
    path.join(path.dirname(spinePath(adoptedRoot())), 'brd-milestones.json'), 'utf8'));
  const labels = new Set(spine.map((r) => r.label));
  for (const m of milestones) {
    for (const id of m.requirements) {
      assert.ok(labels.has(id), `${m.id} names ${id}, which resolves to no requirement label`);
    }
  }
});

test('--verify passes on the untouched adopted spine', () => {
  const r = verifySpine(adoptedRoot());
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /24 adopted requirements intact/);
});

test('--verify catches the live failure: the spine re-keyed to PRD labels', () => {
  const dir = adoptedRoot();
  fs.writeFileSync(spinePath(dir), JSON.stringify(
    readSpine(dir).map((r) => ({ ...r, id: r.label, traces: [r.label] })), null, 1));
  const r = verifySpine(dir);
  assert.strictEqual(r.status, 1, 'this is exactly what shipped unnoticed');
  assert.match(r.out, /re-keyed/);
});

// What the renderer is supposed to do must keep passing, or the gate is a
// blocker on correct behaviour rather than a check on incorrect behaviour.
test('--verify passes after the renderer fills the taxonomy slots it owns', () => {
  const dir = adoptedRoot();
  fs.writeFileSync(spinePath(dir), JSON.stringify(
    readSpine(dir).map((r) => ({ ...r, taxonomy: ['functional'] })), null, 1));
  assert.strictEqual(verifySpine(dir).status, 0);
});
