'use strict';

// Shared helpers for the pre-commit gate registry (extracted from git-hooks/pre-commit).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const FLOOR = 80;

function fail(message) {
  process.stdout.write(message);
  process.stderr.write(message);
  process.exit(1);
}

// A gate that should have run but failed open is announced, not swallowed.
function noteSkip(gate, reason) {
  process.stdout.write(
    `WARNING: GATE SKIPPED — ${gate} did not run (${reason}). Staged code was NOT verified by this gate.\n` +
      `         Fix: provision the toolchain, or set the matching *_GATE=off to acknowledge the skip.\n`
  );
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
  noteSkip,
  stagedFiles,
  inAutoBuild,
  requireScript,
  buildContext,
};
