'use strict';

// Shared helpers for the pre-commit gate registry (extracted from git-hooks/pre-commit).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureTierFooter, formatSkip, formatBlock } = require('./gate-result');
const { recordOutcome } = require('./sensor-outcomes');

const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const FLOOR = 80;

/** Optional context set by gate-registry so fail()/noteSkip can print Tier: and log outcomes */
let failContext = { tier: null, currentSensor: null, projectDir: null };

function setFailContext(ctx) {
  failContext = { tier: null, currentSensor: null, projectDir: null, ...ctx };
}

function getFailContext() {
  return failContext;
}

function fail(message) {
  if (failContext.currentSensor && failContext.projectDir) {
    recordOutcome(failContext.projectDir, { sensor: failContext.currentSensor, ran: true, blocked: true, surface: 'commit' });
  }
  const msg = ensureTierFooter(message, failContext.tier);
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(1);
}


// ---- reviewed waivers ----
//
// specs/reviews/sensor-waivers.json had a schema, a validator, a documented policy and a
// "Waive:" line in every gate's failure message — but nothing read it for enforcement.
// The mechanism was inert, so the only real escape was the blunt HARNESS_*_GATE=off that
// docs/sensor-arbitration.md explicitly calls "not a substitute for a reviewed waiver".
//
// A waiver is narrow, reviewed and expiring. It fails CLOSED at every step: no file, a
// malformed file, a missing field, a placeholder reason, or a past expiry all mean NO
// waiver. And a waived gate is announced loudly — a suppression nobody can see is worse
// than no gate at all.
const WAIVERS_REL = path.join('specs', 'reviews', 'sensor-waivers.json');
const REQUIRED_WAIVER_FIELDS = ['sensor_id', 'scope', 'reason', 'expires', 'approved_by'];
const MIN_REASON_LEN = 12; // mirrors sensor-waivers.schema.json

function waiverUsable(w, sensorId, today) {
  if (!w || w.sensor_id !== sensorId) return false;
  for (const f of REQUIRED_WAIVER_FIELDS) {
    if (typeof w[f] !== 'string' || !w[f].trim()) return false;
  }
  if (w.reason.trim().length < MIN_REASON_LEN) return false;
  // Date-only compare; an expiry of today is still valid, tomorrow is not.
  return String(w.expires) >= String(today);
}

function findWaiver(projectDir, sensorId, today = new Date().toISOString().slice(0, 10)) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(projectDir, WAIVERS_REL), 'utf8'));
  } catch (_) {
    return null; // absent or unparseable => fail closed
  }
  const list = Array.isArray(doc && doc.waivers) ? doc.waivers : [];
  return list.find((w) => waiverUsable(w, sensorId, today)) || null;
}

function formatWaived(sensorId, waiver) {
  return `WAIVED [${sensorId}]: this gate would have BLOCKED, but a reviewed waiver applies.\n` +
    `         scope:    ${waiver.scope}\n` +
    `         approved: ${waiver.approved_by}   expires: ${waiver.expires}\n` +
    `         reason:   ${String(waiver.reason).slice(0, 200)}\n` +
    `         The finding is NOT fixed — it is accepted, on the record, until the expiry.\n`;
}

/** BLOCKED message via formatBlock (Fix / Waive / Tier). */
function failBlock(opts) {
  const projectDir = failContext.projectDir;
  const waiver = projectDir && opts.id ? findWaiver(projectDir, opts.id) : null;
  if (waiver) {
    // Loud, and recorded as a run that did NOT block, so the bite ledger shows the gate
    // fired rather than pretending it was never reached.
    process.stdout.write(formatWaived(opts.id, waiver));
    if (failContext.currentSensor) {
      recordOutcome(projectDir, { sensor: opts.id, ran: true, blocked: false, surface: 'commit' });
    }
    return;
  }
  fail(formatBlock({
    ...opts,
    tier: opts.tier != null ? opts.tier : failContext.tier,
  }));
}

// A gate that should have run but failed open is announced, not swallowed.
function noteSkip(gate, reason) {
  process.stdout.write(formatSkip(gate, reason, failContext.tier));
}

// Node's default subprocess buffer is 1MB. A staged `git diff` can exceed that on a
// large commit, and the failure mode was the worst possible one: ENOBUFS crashed the
// gate runner, and the pre-commit wrapper reported "gates SKIPPED — this commit is NOT
// gated". A gate that dies on big diffs stops working exactly when there is most to
// check, so every git call in the commit path goes through here.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function gitExec(projectDir) {
  return (cmd, args) => execFileSync(cmd, args, {
    cwd: projectDir, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER,
  });
}

function stagedFiles(projectDir) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: projectDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean);
}

function inAutoBuild(projectDir) {
  try {
    const progress = fs.readFileSync(path.join(projectDir, 'claude-progress.txt'), 'utf8');
    const m = progress.match(/^current_group:\s*(.+)$/m);
    return !!(m && m[1].trim());
  } catch (_) {
    return false;
  }
}

/** Resolve .claude/scripts/<name> from a module under .claude/hooks/lib/ */
function requireScript(name) {
  // hooks/lib → .claude/scripts (two levels up to .claude)
  return require(path.join(__dirname, '..', '..', 'scripts', name));
}

function buildContext(projectDir) {
  const staged = stagedFiles(projectDir);
  const stagedSource = staged.filter((f) => SOURCE_EXTS.has(path.extname(f).toLowerCase()));
  const stagedPy = stagedSource.filter((f) => f.endsWith('.py'));
  const stagedTs = stagedSource.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  const stagedJs = stagedSource.filter((f) => {
    const e = path.extname(f).toLowerCase();
    return e === '.js' || e === '.jsx' || e === '.mjs' || e === '.cjs' || e === '.ts' || e === '.tsx';
  });
  return { projectDir, staged, stagedSource, stagedPy, stagedTs, stagedJs };
}

module.exports = {
  findWaiver,
  formatWaived,
  gitExec,
  GIT_MAX_BUFFER,
  SOURCE_EXTS,
  FLOOR,
  fail,
  failBlock,
  noteSkip,
  setFailContext,
  getFailContext,
  stagedFiles,
  inAutoBuild,
  requireScript,
  buildContext,
};
