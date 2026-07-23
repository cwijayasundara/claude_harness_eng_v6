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

/** BLOCKED message via formatBlock (Fix / Waive / Tier). */
function failBlock(opts) {
  fail(formatBlock({
    ...opts,
    tier: opts.tier != null ? opts.tier : failContext.tier,
  }));
}

// A gate that should have run but failed open is announced, not swallowed.
function noteSkip(gate, reason) {
  process.stdout.write(formatSkip(gate, reason, failContext.tier));
}

function stagedFiles(projectDir) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: projectDir,
    encoding: 'utf8',
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
