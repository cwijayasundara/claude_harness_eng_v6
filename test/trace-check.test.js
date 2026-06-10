'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

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
  const spec = fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'spec', 'SKILL.md'), 'utf8');
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
  const design = fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'design', 'SKILL.md'), 'utf8');
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
