'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'skills', 'brd', 'scripts', 'grounding-check.js');
const { checkGrounding } = require(SCRIPT);

// --- pure-function tests (the core logic) -------------------------------------

const frd = [
  { id: 'FRD-1', text: 'Users reset password via email', section: '3.2' },
  { id: 'FRD-2', text: 'Users see order history', section: '4.1' },
];
const clar = [{ id: 'C1', question: 'token TTL?', answer: '1 hour' }];

test('passes when every BRD req traces to the FRD or a clarification and every FRD req is covered', () => {
  const brd = [
    { id: 'BR-1', text: 'Password reset email, 1h token', traces: ['FRD-1', 'C1'] },
    { id: 'BR-2', text: 'Order history list', traces: ['FRD-2'] },
  ];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.net_new, []);
  assert.deepStrictEqual(v.dropped, []);
  assert.strictEqual(v.frd_total, 2);
  assert.strictEqual(v.frd_covered, 2);
});

test('flags a net-new BRD requirement (traces to nothing) as a hard failure', () => {
  const brd = [
    { id: 'BR-1', text: 'Password reset', traces: ['FRD-1'] },
    { id: 'BR-2', text: 'Order history', traces: ['FRD-2'] },
    { id: 'BR-3', text: 'Admin bulk-delete users', traces: [] },
  ];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.net_new.length, 1);
  assert.strictEqual(v.net_new[0].id, 'BR-3');
});

test('flags a BRD requirement tracing to a non-existent id as net-new', () => {
  const brd = [
    { id: 'BR-1', text: 'x', traces: ['FRD-1'] },
    { id: 'BR-2', text: 'y', traces: ['FRD-2'] },
    { id: 'BR-3', text: 'invented', traces: ['FRD-99'] },
  ];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.net_new.map((r) => r.id), ['BR-3']);
});

test('flags a dropped FRD requirement (no BRD req covers it) as a hard failure', () => {
  const brd = [{ id: 'BR-1', text: 'Password reset', traces: ['FRD-1'] }];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.dropped.map((r) => r.id), ['FRD-2']);
  assert.strictEqual(v.frd_covered, 1);
});

test('a clarification-only trace is grounded (sanctioned net-new), not flagged', () => {
  const brd = [
    { id: 'BR-1', text: 'Password reset', traces: ['FRD-1'] },
    { id: 'BR-2', text: 'Order history', traces: ['FRD-2'] },
    { id: 'BR-3', text: 'token TTL is 1h', traces: ['C1'] },
  ];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.net_new, []);
});

test('reports both net-new and dropped together', () => {
  const brd = [
    { id: 'BR-1', text: 'Password reset', traces: ['FRD-1'] },
    { id: 'BR-2', text: 'invented', traces: [] },
  ];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.net_new.length, 1);
  assert.strictEqual(v.dropped.length, 1); // FRD-2 uncovered
});

test('treats a missing/empty traces field as net-new (never silently grounded)', () => {
  const brd = [
    { id: 'BR-1', text: 'Password reset', traces: ['FRD-1'] },
    { id: 'BR-2', text: 'Order history', traces: ['FRD-2'] },
    { id: 'BR-3', text: 'no traces field at all' },
  ];
  const v = checkGrounding(frd, clar, brd);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.net_new.map((r) => r.id), ['BR-3']);
});

// --- CLI tests ----------------------------------------------------------------

function writeJson(dir, rel, data) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

test('CLI writes the verdict to --out and exits 0 on pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'specs/brd/frd-requirements.json', frd);
  writeJson(dir, 'specs/brd/clarification-log.json', clar);
  writeJson(dir, 'specs/brd/brd-requirements.json', [
    { id: 'BR-1', text: 'x', traces: ['FRD-1'] },
    { id: 'BR-2', text: 'y', traces: ['FRD-2'] },
  ]);
  const out = path.join(dir, 'specs/reviews/brd-grounding.json');
  execFileSync(process.execPath, [SCRIPT,
    '--frd', path.join(dir, 'specs/brd/frd-requirements.json'),
    '--clarifications', path.join(dir, 'specs/brd/clarification-log.json'),
    '--brd', path.join(dir, 'specs/brd/brd-requirements.json'),
    '--out', out]);
  const verdict = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(verdict.pass, true);
});

test('CLI exits non-zero on a grounding violation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'frd.json', frd);
  writeJson(dir, 'clar.json', clar);
  writeJson(dir, 'brd.json', [{ id: 'BR-1', text: 'invented', traces: [] }]);
  const out = path.join(dir, 'out.json');
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [SCRIPT,
      '--frd', path.join(dir, 'frd.json'),
      '--clarifications', path.join(dir, 'clar.json'),
      '--brd', path.join(dir, 'brd.json'),
      '--out', out], { stdio: 'pipe' });
  } catch (e) {
    exitCode = e.status;
  }
  assert.strictEqual(exitCode, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, false);
});

test('CLI works without a clarification log (FRD-only grounding)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'frd.json', [{ id: 'FRD-1', text: 'x', section: '1' }]);
  writeJson(dir, 'brd.json', [{ id: 'BR-1', text: 'x', traces: ['FRD-1'] }]);
  const out = path.join(dir, 'out.json');
  execFileSync(process.execPath, [SCRIPT,
    '--frd', path.join(dir, 'frd.json'),
    '--brd', path.join(dir, 'brd.json'),
    '--out', out]);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, true);
});

// --- interview-mode grounding (2026-07-02 audit fix #3) -----------------------
// The engine is source-agnostic: the confirmed interview spine (INT-n) rides in
// as the required set exactly like an FRD. Round-trips the REAL script.

const interview = [
  { id: 'INT-1', text: 'Admins invite users by email', section: 'users-and-permissions' },
  { id: 'INT-2', text: 'Weekly usage digest email', section: 'reporting' },
];

test('interview mode: CLI passes when every BR traces to INT-n/C-n and every INT-n is covered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'specs/brd/interview-requirements.json', interview);
  writeJson(dir, 'specs/brd/clarification-log.json', [{ id: 'C1', question: 'digest day?', answer: 'Monday' }]);
  writeJson(dir, 'specs/brd/brd-requirements.json', [
    { id: 'BR-1', text: 'Email invitations', traces: ['INT-1'] },
    { id: 'BR-2', text: 'Monday usage digest', traces: ['INT-2', 'C1'] },
  ]);
  const out = path.join(dir, 'specs/reviews/brd-grounding.json');
  execFileSync(process.execPath, [SCRIPT,
    '--frd', path.join(dir, 'specs/brd/interview-requirements.json'),
    '--clarifications', path.join(dir, 'specs/brd/clarification-log.json'),
    '--brd', path.join(dir, 'specs/brd/brd-requirements.json'),
    '--out', out]);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, true);
});

test('interview mode: CLI blocks an invented BR and a dropped INT-n together', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'int.json', interview);
  writeJson(dir, 'brd.json', [
    { id: 'BR-1', text: 'Email invitations', traces: ['INT-1'] },
    { id: 'BR-2', text: 'Invented SSO federation', traces: [] },
  ]);
  const out = path.join(dir, 'out.json');
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [SCRIPT,
      '--frd', path.join(dir, 'int.json'),
      '--brd', path.join(dir, 'brd.json'),
      '--out', out], { stdio: 'pipe' });
  } catch (e) {
    exitCode = e.status;
  }
  assert.strictEqual(exitCode, 1);
  const verdict = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual(verdict.net_new.map((r) => r.id), ['BR-2']);
  assert.deepStrictEqual(verdict.dropped.map((r) => r.id), ['INT-2']);
});

// --- wiring consistency: the gate is referenced across skill + rubric + evaluator ---

const fsw = require('fs');
const pathw = require('path');
const ROOTW = pathw.join(__dirname, '..');

test('/brd skill documents the --frd flow and runs the grounding gate', () => {
  const brd = fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8');
  assert.match(brd, /--frd/);
  assert.match(brd, /source-frd\.md/);
  assert.match(brd, /clarification-log\.json/);
  assert.match(brd, /brd-requirements\.json/);
  assert.match(brd, /grounding-check\.js/);
  assert.match(brd, /HARD BLOCK/);
  assert.match(brd, /net_new/);
  assert.match(brd, /dropped/);
  assert.match(brd, /interview-requirements\.json/);
  assert.match(brd, /INT-\d|INT-<n>|INT-n/);
  assert.match(brd, /HARD BLOCK — all modes|HARD BLOCK — FRD & interview/);
});

test('rubric brd phase has the FRD hard-gate and grounded traceability criterion', () => {
  const rubric = JSON.parse(fsw.readFileSync(pathw.join(ROOTW, '.claude', 'templates', 'phase-eval-rubrics.json'), 'utf8'));
  const brd = rubric.phases.brd;
  assert.match(brd.hard_gate, /brd-grounding\.json/);
  assert.match(brd.hard_gate, /net_new/);
  assert.match(brd.criteria.traceability, /brd-grounding\.json/);
  assert.match(brd.hard_gate, /interview-requirements\.json/);
  assert.match(brd.criteria.traceability, /INT-n|interview-requirements/);
  assert.ok(!/score as 10/.test(brd.criteria.traceability), 'interview mode must no longer auto-score 10');
});

test('evaluator artifact mode hard-gates the BRD on the grounding verdict in FRD mode', () => {
  const ev = fsw.readFileSync(pathw.join(ROOTW, '.claude', 'agents', 'evaluator.md'), 'utf8');
  assert.match(ev, /brd-grounding\.json/);
  assert.match(ev, /FRD mode/);
  assert.match(ev, /interview-from-scratch/i);
  assert.match(ev, /interview-requirements\.json/);
});
