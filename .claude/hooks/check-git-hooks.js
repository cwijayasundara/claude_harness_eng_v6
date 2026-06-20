#!/usr/bin/env node

'use strict';

// SessionStart — warn when the harness commit-time gates aren't installed.
// /scaffold copies the pre-commit / commit-msg git hooks (coverage ratchet,
// sprint-contract, security-verdict, refactor purity) into .git/hooks. A repo
// created with `git init` but never (re-)scaffolded silently loses that entire
// gate layer — commits look gated but aren't. We detect the missing pre-commit
// hook and surface a one-line fix. Advisory only: this never blocks.
// Exemptions: the harness repo deliberately runs without these hooks installed,
// and a foreign (non-harness) pre-commit is left alone to avoid false alarms.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProjectDir, reportFailure } = require('./lib/common');
const { isHarnessRepo } = require('./lib/trust-boundary');

const HARNESS_MARKER = 'commit-time quality gate'; // from the hook's own header

// Path git would use for the pre-commit hook, honoring core.hooksPath. Returns
// null when this is not a git repository (or git is unavailable).
function preCommitPath(projectDir) {
  const res = spawnSync('git', ['-C', projectDir, 'rev-parse', '--git-path', 'hooks/pre-commit'], { encoding: 'utf8' });
  if (!res || res.status !== 0 || !res.stdout) return null;
  return path.resolve(projectDir, res.stdout.trim());
}

// Installed and recognizably ours? A foreign pre-commit is treated as "present"
// so we don't nag projects that manage their own hooks.
function harnessHookInstalled(hookPath) {
  try {
    return fs.readFileSync(hookPath, 'utf8').includes(HARNESS_MARKER);
  } catch (_) {
    return false;
  }
}

function warn() {
  process.stdout.write(
    'WARNING: harness git hooks are not installed in this repository.\n' +
    'The commit-time gates (coverage ratchet, sprint-contract, security verdict, refactor purity) will NOT run.\n' +
    'Fix: cp .claude/git-hooks/{pre-commit,commit-msg,prepare-commit-msg} .git/hooks/ && \\\n' +
    '     chmod +x .git/hooks/{pre-commit,commit-msg,prepare-commit-msg}   (or re-run /scaffold).\n'
  );
}

try {
  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  if (!isHarnessRepo(projectDir)) {
    const hook = preCommitPath(projectDir);
    if (hook && !fs.existsSync(hook)) warn();
    else if (hook && !harnessHookInstalled(hook)) warn();
  }
} catch (err) {
  reportFailure('check-git-hooks', err);
}

process.exit(0);
