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

// --- enforcement --------------------------------------------------------------
//
// The handoff above is advisory, and on a live run it was printed and ignored:
// /spec ran on in the same session, at a 273K average context against ~110K for
// a fresh one. Printing louder is not a control. The successor phase refusing to
// start until the context is actually clear is.
//
// The signal is deterministic: the approving session's id is stamped into the
// receipt, and the live session's id is on the run receipts the hooks already
// write. Same id => the approving conversation is still resident.

const { PREV_PHASE, staleContext } = require(
  path.join(ROOT, '.claude/hooks/lib/phase-handoff.js'),
);

test('every hop the handoff advertises has an inverse the successor can check', () => {
  for (const [phase, hop] of Object.entries(NEXT_PHASE)) {
    const next = hop.next.replace('/', '');
    if (!Object.prototype.hasOwnProperty.call(PREV_PHASE, next)) continue;
    assert.strictEqual(PREV_PHASE[next], phase,
      `${next} must know ${phase} is what it has to be clear of`);
  }
});

test('the successor is blocked when the upstream phase was approved in this session', () => {
  const v = staleContext({
    phase: 'spec',
    receipt: { phase: 'brd', session_id: 'S1' },
    sessionId: 'S1',
  });
  assert.strictEqual(v.blocked, true);
  assert.match(v.message, /\/clear/);
  assert.match(v.message, /brd/);
});

test('a fresh session passes', () => {
  const v = staleContext({
    phase: 'spec',
    receipt: { phase: 'brd', session_id: 'S1' },
    sessionId: 'S2',
  });
  assert.strictEqual(v.blocked, false);
});

// Each of these would turn the control into a block that fires on the wrong
// thing, which is worse than no block: it trains operators to bypass it.
test('the entry phase has no predecessor and is never blocked', () => {
  assert.strictEqual(staleContext({ phase: 'brd', receipt: null, sessionId: 'S1' }).blocked, false);
});

test('a missing upstream receipt is not this control\'s business', () => {
  // The approval gate already fails an unapproved upstream phase. Blocking here
  // too would report a context problem for what is actually a missing approval.
  assert.strictEqual(staleContext({ phase: 'spec', receipt: null, sessionId: 'S1' }).blocked, false);
});

test('an unknown live session id does not block — absence of evidence is not evidence', () => {
  assert.strictEqual(
    staleContext({ phase: 'spec', receipt: { session_id: 'S1' }, sessionId: null }).blocked,
    false,
  );
});

test('a receipt written before session stamping existed does not block', () => {
  assert.strictEqual(
    staleContext({ phase: 'spec', receipt: { phase: 'brd' }, sessionId: 'S1' }).blocked,
    false,
  );
});

test('/build conducts every phase from one session and is exempt', () => {
  const v = staleContext({
    phase: 'spec',
    receipt: { phase: 'brd', session_id: 'S1' },
    sessionId: 'S1',
    inSession: true,
  });
  assert.strictEqual(v.blocked, false);
});

// --- the control end to end ---------------------------------------------------

const { run: handoffCheck } = require(path.join(ROOT, '.claude/scripts/handoff-check.js'));
const { run: approval } = require(path.join(ROOT, '.claude/scripts/plan-approval.js'));

/** A project whose /brd was approved by `sessionId`. */
function approvedBrd(sessionId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-e2e-'));
  fs.mkdirSync(path.join(dir, 'specs/brd'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/brd/brd.md'), '# BRD\n');
  fs.mkdirSync(path.join(dir, '.claude/runs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: sessionId })}\n`,
  );
  const code = approval([
    'record', '--phase', 'brd', '--verdict', 'approved',
    '--artifact', 'specs/brd/brd.md', '--root', dir,
  ], dir);
  assert.strictEqual(code, 0, 'the fixture must actually record an approval');
  return dir;
}

test('the approving session is stamped into the receipt', () => {
  const dir = approvedBrd('SESSION-A');
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'specs/reviews/brd-approval.json'), 'utf8'));
  assert.strictEqual(receipt.session_id, 'SESSION-A');
});

test('/spec is blocked in the session that approved /brd, and cleared in a fresh one', () => {
  const dir = approvedBrd('SESSION-A');
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--root', dir], dir,
    { liveSessionId: () => 'SESSION-A' }), 1);
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--root', dir], dir,
    { liveSessionId: () => 'SESSION-B' }), 0);
});

test('the block reads the live session from the run receipts, with nothing injected', () => {
  // The real path: no dependency override, the id resolved from .claude/runs.
  const dir = approvedBrd('SESSION-A');
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--root', dir], dir), 1,
    'the fixture writes SESSION-A as the newest receipt, so this IS the approving session');
});

test('--in-session exempts /build, which cannot clear itself mid-run', () => {
  const dir = approvedBrd('SESSION-A');
  assert.strictEqual(
    handoffCheck(['--phase', 'spec', '--root', dir, '--in-session'], dir), 0,
  );
});

test('a phase with no approved predecessor is not blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-none-'));
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--root', dir], dir), 0);
});

test('an unknown phase is a usage error, not a silent pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-bad-'));
  assert.strictEqual(handoffCheck(['--phase', 'brd', '--root', dir], dir), 2,
    'brd is the entry phase — asking it to be clear of something is a caller bug');
  assert.strictEqual(handoffCheck(['--root', dir], dir), 2);
});

// /build's exemption must not depend on the model remembering a second flag at
// a different call site. It already records approvals with --in-session; that
// fact rides in the receipt, so the successor phase exempts itself.
test('an approval recorded --in-session exempts the successor without any flag', () => {
  const v = staleContext({
    phase: 'spec',
    receipt: { phase: 'brd', session_id: 'S1', in_session: true },
    sessionId: 'S1',
  });
  assert.strictEqual(v.blocked, false);
});

test('the --in-session fact is recorded on the receipt', () => {
  const dir = approvedBrd('SESSION-A');
  const plain = JSON.parse(fs.readFileSync(path.join(dir, 'specs/reviews/brd-approval.json'), 'utf8'));
  assert.strictEqual(plain.in_session, false);

  fs.writeFileSync(path.join(dir, 'specs/brd/brd.md'), '# BRD v2\n');
  approval([
    'record', '--phase', 'brd', '--verdict', 'approved',
    '--artifact', 'specs/brd/brd.md', '--root', dir, '--in-session',
  ], dir);
  const built = JSON.parse(fs.readFileSync(path.join(dir, 'specs/reviews/brd-approval.json'), 'utf8'));
  assert.strictEqual(built.in_session, true);
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--root', dir], dir), 0,
    '/build must not block itself');
});

// --- the intra-phase checkpoint ----------------------------------------------
//
// The phase-boundary clear above is not the whole win. /spec's decisions gate is
// a durable checkpoint MID-phase: once spec-decisions.json passes, everything
// after it — dispatching spec-render, the grounding gates, the evaluation — runs
// off that file and needs none of the shaping dialogue.
//
// On the audited run, 40 of /spec's 47 turns fell after the gate, at a 284K
// average context, costing $5.67. The same stretch re-entered fresh via the
// already-existing `/spec --render-only` would cost ~$2.20.

const { staleRenderContext, renderHandoffBlock } = require(
  path.join(ROOT, '.claude/hooks/lib/phase-handoff.js'),
);

test('the render handoff names the clear and the re-entry command', () => {
  const block = renderHandoffBlock('spec');
  assert.match(block, /\/clear/);
  assert.match(block, /\/spec --render-only/);
});

test('the render stretch is blocked in the session that shaped the decisions', () => {
  const v = staleRenderContext({ phase: 'spec', verdict: { session_id: 'S1' }, sessionId: 'S1' });
  assert.strictEqual(v.blocked, true);
  assert.match(v.message, /--render-only/);
});

test('a fresh session may render', () => {
  assert.strictEqual(
    staleRenderContext({ phase: 'spec', verdict: { session_id: 'S1' }, sessionId: 'S2' }).blocked, false,
  );
});

// A lane with no human cannot clear, and a gate that stops it is a broken gate.
test('a waived (headless) decisions gate never blocks the render', () => {
  assert.strictEqual(
    staleRenderContext({ phase: 'spec', verdict: { session_id: 'S1', waived_by: '--autonomous' }, sessionId: 'S1' }).blocked,
    false,
  );
});

test('an --in-session conductor is exempt, as at the phase boundary', () => {
  assert.strictEqual(
    staleRenderContext({ phase: 'spec', verdict: { session_id: 'S1', in_session: true }, sessionId: 'S1' }).blocked,
    false,
  );
});

test('every uncertain case passes, as at the phase boundary', () => {
  for (const args of [
    { phase: 'spec', verdict: null, sessionId: 'S1' },
    { phase: 'spec', verdict: { session_id: 'S1' }, sessionId: null },
    { phase: 'spec', verdict: {}, sessionId: 'S1' },
  ]) {
    assert.strictEqual(staleRenderContext(args).blocked, false, JSON.stringify(args));
  }
});

// --- the render checkpoint, end to end ---------------------------------------

const { execFileSync } = require('node:child_process');

/** A project whose decisions gate has passed in `sessionId`. */
function gatedDecisions(sessionId, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-e2e-'));
  fs.mkdirSync(path.join(dir, 'specs/decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/decisions/spec-decisions.json'), JSON.stringify({
    version: 1,
    phase: 'spec',
    source: 'specs/brd/brd.md',
    confirmed_at: '2026-08-09T10:00:00.000Z',
    milestone: { name: 'M1', epics: ['E1'], deferred_epics: [] },
    decisions: [{
      id: 'D1',
      question: 'Which epics are in milestone 1?',
      chosen: 'E1',
      rationale: 'It is the only one with no upstream dependency.',
      basis: 'human',
      load_bearing: true,
    }],
  }, null, 2));
  fs.mkdirSync(path.join(dir, '.claude/runs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude/runs/2026-08-09.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: sessionId })}\n`);
  execFileSync('node', [
    path.join(ROOT, '.claude/scripts/validate-spec-decisions.js'), '--root', dir, ...extra,
  ], { encoding: 'utf8' });
  return dir;
}

test('--stage render blocks in the shaping session and clears in a fresh one', () => {
  const dir = gatedDecisions('SESSION-A');
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--stage', 'render', '--root', dir], dir,
    { liveSessionId: () => 'SESSION-A' }), 1);
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--stage', 'render', '--root', dir], dir,
    { liveSessionId: () => 'SESSION-B' }), 0);
});

test('--stage render reads the live session for real, with nothing injected', () => {
  const dir = gatedDecisions('SESSION-A');
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--stage', 'render', '--root', dir], dir), 1);
});

test('a decisions gate passed --in-session does not block the render', () => {
  const dir = gatedDecisions('SESSION-A', ['--in-session']);
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--stage', 'render', '--root', dir], dir), 0);
});

test('--stage render with no decisions verdict yet does not block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-none-'));
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--stage', 'render', '--root', dir], dir), 0);
});

// The two checkpoints are distinct: the boundary one reads the /brd receipt,
// this one reads the decisions verdict. Confusing them would block the wrong
// stretch, so the stage must be explicit rather than inferred.
test('--stage render is defined for the phases that can re-enter, and only those', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-phase-'));
  // /test renders nothing and has no --render-only to come back through.
  assert.strictEqual(handoffCheck(['--phase', 'test', '--stage', 'render', '--root', dir], dir), 2);
  assert.strictEqual(handoffCheck(['--phase', 'spec', '--stage', 'bogus', '--root', dir], dir), 2);
  assert.strictEqual(handoffCheck(['--phase', 'design', '--stage', 'render', '--root', dir], dir), 0,
    'design has --render-only, so its render stage is defined');
});

// The measurement is /spec's. /design has never been metered, so its block must
// not present /spec's figure as its own — a control that cites evidence it does
// not have is the same class of defect as a gate that passes on invented input.
test('each phase cites evidence it actually has', () => {
  assert.match(renderHandoffBlock('spec'), /On a metered run this/);
  assert.match(renderHandoffBlock('design'), /The equivalent stretch\s+in \/spec was/);
  assert.doesNotMatch(renderHandoffBlock('design'), /On a metered run this/);
});
