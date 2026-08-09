#!/usr/bin/env node

'use strict';

// Receipt + gate for the human plan-review loop at /spec, /design, and /test.
//
// The pipeline already stopped at these phases and asked "approve?". Prose alone
// cannot tell later stages whether that stop ever happened, what the human said,
// or whether the artifacts still resemble what they approved — so the stop was
// unobservable and, on a long run, skippable. This records each review round and
// gates the next phase on the result.
//
// Three properties keep the receipt from decaying into a rubber stamp:
//   1. Feedback must say something. "n/a" and "looks fine" are not review.
//   2. An approval following a changes-requested round must account for that
//      feedback — what changed, or what was declined and why.
//   3. An approval is void once the approved artifacts change. Approval is of a
//      specific plan, not of the phase in general.
//
// CLI:
//   plan-approval.js record --phase <spec|design|test> --verdict <changes-requested|approved>
//        [--feedback "<verbatim>"]... [--changes "<what changed>"]... [--declined "<why not>"]...
//        [--questions N] [--answered N] [--artifact <path>]... [--root DIR]
//        [--in-session]   suppress the /clear handoff; for /build, which
//                         conducts every phase from one session
//   plan-approval.js waive --phase <p> --lane <--auto|--autonomous> [--root DIR]
//   plan-approval.js check --phase <spec|design|test|all> [--require-human] [--root DIR]
//
// Exit: 0 = pass, 1 = gate failure (unapproved / stale), 2 = usage or IO error.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { handoffOn } = require('../hooks/lib/phase-handoff.js');
const { liveSessionId } = require('../hooks/lib/live-session.js');

// brd joined the list when /brd was de-forked: before that its approval could
// not reach a human, so a receipt would have recorded a stop that never
// happened. A real gated run produced no brd-approval.json at all.
const PHASES = ['brd', 'spec', 'design', 'test'];

// Where each phase's work lands. `--phase all` gates a phase only when its
// artifacts exist: /sprint and /feature reach /auto through lanes that never run
// a test-planning phase, and a gate that blocks a lane for not producing an
// artifact it was never supposed to produce is a broken gate, not a strict one.
// An explicitly named phase is always required — naming it is the assertion.
const PHASE_ARTIFACTS = {
  brd: path.join('specs', 'brd'),
  spec: path.join('specs', 'stories'),
  design: path.join('specs', 'design'),
  test: path.join('specs', 'test_artefacts'),
};
const VERDICTS = new Set(['changes-requested', 'approved']);
const LANES = new Set(['--auto', '--autonomous']);

// A review comment must carry information. These are the shapes that carry none.
const PLACEHOLDERS = /^(n\/?a|none|nil|no|yes|ok|okay|fine|good|lgtm|looks fine|looks good|approved|tbd|todo|-+|\.+)$/i;
const MIN_FEEDBACK_CHARS = 20;

function receiptPath(root, phase) {
  return path.join(root, 'specs', 'reviews', `${phase}-approval.json`);
}

function readReceipt(root, phase) {
  const file = receiptPath(root, phase);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeReceipt(root, phase, receipt) {
  const file = receiptPath(root, phase);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

/** All values for a repeatable flag, in order. */
function multi(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== name) continue;
    const value = argv[i + 1];
    if (value !== undefined && !String(value).startsWith('--')) out.push(String(value));
  }
  return out;
}

function arg(argv, name, fallback) {
  const values = multi(argv, name);
  return values.length ? values[values.length - 1] : fallback;
}

/**
 * The next token verbatim, flag-shaped or not. Only for flags whose legal values
 * are themselves flags (`--lane --auto`); a closed value set does the guarding
 * that `multi`'s startsWith check does everywhere else.
 */
function rawArg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] === undefined ? null : String(argv[i + 1]));
}

function isSubstantive(text) {
  const trimmed = String(text == null ? '' : text).trim();
  return trimmed.length >= MIN_FEEDBACK_CHARS && !PLACEHOLDERS.test(trimmed);
}

function digest(root, rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(message) {
  process.stderr.write(`plan-approval: ${message}\n`);
  return 2;
}

/** Every artifact named on an approval must exist; a missing one was not reviewed. */
function resolveArtifacts(root, rels) {
  const artifacts = [];
  for (const rel of rels) {
    const sha256 = digest(root, rel);
    if (!sha256) return { error: `artifact not found: ${rel}` };
    artifacts.push({ path: rel, sha256 });
  }
  return { artifacts };
}

/**
 * Zero feedback and zero answered questions across the whole loop means the
 * human clicked past the gate. Recorded, never blocking — a plan can genuinely
 * be right the first time, and the signal belongs in /retro, not in the way.
 */
function lowEngagement(rounds) {
  return !rounds.some((r) => r.feedback.length > 0 || r.answered > 0);
}

function priorFeedback(receipt) {
  return (receipt ? receipt.rounds : []).some((r) => r.feedback.length > 0);
}

function buildRound(argv, receipt, verdict) {
  const feedback = multi(argv, '--feedback').filter(isSubstantive);
  return {
    round: (receipt ? receipt.rounds.length : 0) + 1,
    verdict,
    feedback,
    changes: multi(argv, '--changes').filter(isSubstantive),
    declined: multi(argv, '--declined').filter(isSubstantive),
    questions_asked: Number(arg(argv, '--questions', 0)) || 0,
    answered: Number(arg(argv, '--answered', 0)) || 0,
  };
}

function validateRound(round, receipt, artifactRels) {
  if (round.verdict === 'changes-requested' && round.feedback.length === 0) {
    return 'a changes-requested round needs at least one substantive --feedback item '
      + `(>= ${MIN_FEEDBACK_CHARS} chars, not a placeholder)`;
  }
  if (round.verdict !== 'approved') return null;
  if (artifactRels.length === 0) {
    return 'an approval must name what it approves: pass --artifact <path> for each reviewed file';
  }
  if (priorFeedback(receipt) && round.changes.length === 0 && round.declined.length === 0) {
    return 'this loop has open reviewer feedback — record --changes "<what changed>" '
      + 'or --declined "<what you kept and why>" so the approval accounts for it';
  }
  return null;
}

function buildReceipt({ root, phase, verdict, artifacts, round, receipt, inSession }) {
  const rounds = [...(receipt ? receipt.rounds : []), round];
  return {
    phase,
    status: verdict,
    rounds,
    artifacts,
    low_engagement: verdict === 'approved' ? lowEngagement(rounds) : false,
    waived_by: null,
    approvedAt: verdict === 'approved' ? round.recordedAt : null,
    // Which conversation approved this, so the successor phase can refuse to
    // start inside it. Null when undeterminable — see live-session.js.
    session_id: liveSessionId(root),
    // A conductor that owns every phase (/build) cannot clear between them.
    // Recording that here exempts the successor without a second flag.
    in_session: inSession === true,
  };
}

function recordRound(argv, root, phase, now) {
  const verdict = arg(argv, '--verdict', null);
  if (!VERDICTS.has(verdict)) return fail(`--verdict must be one of ${[...VERDICTS].join(' | ')}`);

  const receipt = readReceipt(root, phase);
  const round = buildRound(argv, receipt, verdict);
  const artifactRels = multi(argv, '--artifact');
  const problem = validateRound(round, receipt, artifactRels);
  if (problem) return fail(problem);

  const { artifacts, error } = resolveArtifacts(root, artifactRels);
  if (error) return fail(error);

  round.recordedAt = now();
  writeReceipt(root, phase, buildReceipt({
    root, phase, verdict, artifacts, round, receipt, inSession: argv.includes('--in-session'),
  }));
  process.stdout.write(`plan-approval: ${phase} round ${round.round} recorded as ${verdict}.\n`);
  process.stdout.write(handoffOn(phase, verdict, argv.includes('--in-session')));
  return 0;
}

function waive(argv, root, phase, now) {
  const lane = rawArg(argv, '--lane');
  if (!LANES.has(lane)) return fail(`--lane must be one of ${[...LANES].join(' | ')}`);
  writeReceipt(root, phase, {
    phase,
    status: 'waived',
    rounds: [],
    artifacts: [],
    low_engagement: false,
    waived_by: lane,
    approvedAt: now(),
  });
  process.stdout.write(`plan-approval: ${phase} review waived by ${lane}.\n`);
  return 0;
}

/** Why this phase does not currently pass the gate, or null if it does. */
function gateFailure(root, phase, requireHuman) {
  const receipt = readReceipt(root, phase);
  if (!receipt) return `no review recorded — run the /plan-review-loop for ${phase}`;
  if (receipt.status === 'waived') {
    return requireHuman ? `review was waived by ${receipt.waived_by}; this lane requires a human loop` : null;
  }
  if (receipt.status !== 'approved') return `review is ${receipt.status} after ${receipt.rounds.length} round(s)`;
  const stale = receipt.artifacts.filter((a) => digest(root, a.path) !== a.sha256);
  if (stale.length) {
    return `approved artifacts changed since approval: ${stale.map((a) => a.path).join(', ')} — re-run the loop`;
  }
  return null;
}

/** Did this phase produce anything in this project? */
function phaseRan(root, phase) {
  const dir = path.join(root, PHASE_ARTIFACTS[phase]);
  try {
    return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0;
  } catch (_) {
    return false;
  }
}

function check(argv, root, phase) {
  const requireHuman = argv.includes('--require-human');
  const all = phase === 'all';
  let failed = 0;
  for (const p of all ? PHASES : [phase]) {
    if (all && !phaseRan(root, p)) {
      process.stdout.write(`plan-approval: ${p} skipped — this lane produced no ${PHASE_ARTIFACTS[p]}.\n`);
      continue;
    }
    const problem = gateFailure(root, p, requireHuman);
    if (problem) {
      failed += 1;
      process.stderr.write(`plan-approval: ${p} BLOCKED — ${problem}\n`);
    } else {
      process.stdout.write(`plan-approval: ${p} OK.\n`);
    }
  }
  return failed ? 1 : 0;
}

function run(argv, root, deps) {
  const verb = argv[0];
  const now = (deps && deps.now) || (() => new Date().toISOString());
  const cwd = arg(argv, '--root', root) || root;
  const phase = arg(argv, '--phase', null);
  const allowAll = verb === 'check';
  if (!phase || (!PHASES.includes(phase) && !(allowAll && phase === 'all'))) {
    return fail(`--phase must be one of ${PHASES.join(' | ')}${allowAll ? ' | all' : ''}`);
  }
  if (verb === 'record') return recordRound(argv, cwd, phase, now);
  if (verb === 'waive') return waive(argv, cwd, phase, now);
  if (verb === 'check') return check(argv, cwd, phase);
  return fail('usage: plan-approval.js <record|waive|check> --phase <spec|design|test> [...]');
}

module.exports = { run, readReceipt, receiptPath, gateFailure, isSubstantive, PHASES };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
