'use strict';

// The between-phase /clear handoff.
//
// A metered front-half run billed $118.60 with only $12.00 of generated output;
// $74.10 was cache reads, because phases shared one session and each phase's
// artifacts were re-carried through the next. The handoff is the instruction
// that breaks that chain, and it has to arrive where approval lands rather than
// as prose in a skill file nobody re-reads at the gate.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { NEXT_PHASE, handoffOn, handoffBlock } = require(
  path.join(ROOT, '.claude/hooks/lib/phase-handoff.js'),
);
const { run, PHASES } = require(path.join(ROOT, '.claude/scripts/plan-approval.js'));

function sandbox(phase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  const artifactDir = path.join(dir, 'specs', phase === 'brd' ? 'brd' : 'stories');
  fs.mkdirSync(artifactDir, { recursive: true });
  const rel = path.relative(dir, path.join(artifactDir, 'plan.md'));
  fs.writeFileSync(path.join(dir, rel), 'plan\n');
  return { dir, rel };
}

function record(dir, phase, rel, extra = []) {
  const out = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(s); return true; };
  let code;
  try {
    code = run([
      'record', '--phase', phase, '--verdict', 'approved',
      '--feedback', 'The isolation downgrade needs to be prominent in section 11.',
      '--artifact', rel, '--root', dir, ...extra,
    ], dir, { now: () => '2026-08-09T00:00:00.000Z' });
  } finally {
    process.stdout.write = write;
  }
  return { code, out: out.join('') };
}

test('every gated phase has a successor mapping, so no approval ends without a handoff', () => {
  for (const phase of PHASES) {
    assert.ok(NEXT_PHASE[phase], `${phase} must know what runs after it`);
    assert.match(handoffBlock(phase), /\/clear/, `${phase}'s handoff must name the clear`);
  }
});

test('an approving round prints the handoff naming the next phase', () => {
  const { dir, rel } = sandbox('brd');
  const { code, out } = record(dir, 'brd', rel);
  assert.strictEqual(code, 0);
  assert.match(out, /Run \/clear before \/spec/);
  assert.match(out, /phase-digest\.js --phase spec/,
    'the handoff must point the fresh session at the digest, not the raw artifacts');
});

test('--in-session suppresses the handoff for /build, which cannot clear itself', () => {
  const { dir, rel } = sandbox('brd');
  const { code, out } = record(dir, 'brd', rel, ['--in-session']);
  assert.strictEqual(code, 0);
  assert.doesNotMatch(out, /\/clear/,
    'printing an instruction the conductor cannot follow trains the human to ignore it');
});

test('a changes-requested round prints no handoff — nothing has been approved yet', () => {
  assert.strictEqual(handoffOn('brd', 'changes-requested', false), '');
});

test('/build passes --in-session at the gates it conducts', () => {
  const phases = fs.readFileSync(
    path.join(ROOT, '.claude/skills/build/references/section-04-pipeline-phases.md'), 'utf8',
  );
  assert.match(phases, /record --phase brd --in-session/);
  assert.match(phases, /record --phase spec --in-session/);
  assert.match(phases, /separate invocations/,
    '/build must state that the standalone route is the cheaper one');
});
