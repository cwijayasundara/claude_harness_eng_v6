'use strict';

// Harness machinery the model must not edit mid-run: the hooks and git hooks
// that implement the quality gates, the settings that wire them, the security
// patterns they enforce, and the gate state (coverage baselines, review
// queue, error log). An agent that can rewrite its own gates passes them
// trivially — evaluator-side tampering is the dominant spontaneous integrity
// failure documented for coding agents. Machinery changes belong to the human:
// made in the harness repo (detected via package.json name) or under an
// explicit HARNESS_PROTECT=off.
// Both write paths are guarded: the pre-write gate covers Write/Edit/MultiEdit,
// and pre-bash-gate.js re-applies this same machineryViolation check to write
// targets it extracts from shell commands (redirections, tee, sed -i, cp/mv).

const fs = require('fs');
const path = require('path');

const MACHINERY = [
  /^\.claude\/hooks\//,
  /^\.claude\/git-hooks\//,
  /^\.claude\/settings(?:\.local|\.auto)?\.json$/,
  /^\.claude\/security-patterns\.(json|ya?ml)$/,
  /^\.claude\/unattended-policy\.json$/,
  /^\.claude\/trust\/issuers\.json$/,
  /^\.claude\/authority\//,
  /^\.claude\/certification\/security-boundary\.json$/,
  /^\.claude\/config\/autonomy-policy\.json$/,
  /^\.claude\/state\/(coverage-baseline[^/]*|coverage-preflight-cache\.json|review-block-count|hook-errors\.(log|offset)|pending-reviews\.jsonl|risk-envelope\.json|task-envelope\.json|task-envelope-history\/.*|task-lifecycle\.jsonl|red-phase\.jsonl|task-completion-receipt\.json|autonomy-policy\.json|used-capabilities\/.*|credential-requests\/.*|checkpoints\/.*|current-checkpoint\.json|isolation-evidence\.json|unattended-preflight\.json)$/,
];

// Directories whose CONTENTS are machinery. Needed because the patterns above
// match paths *inside* these directories, so the directory itself matched
// nothing — and `rm -rf .claude/hooks` (or `rm -rf .claude`) defeated every
// file-level guard at once. Removing a container removes what it contains.
//
// Listed explicitly rather than derived from MACHINERY, because several of those
// patterns are anchored on a specific filename (`...task-lifecycle\.jsonl$`) and
// no probe path can recover the directory they live in.
const MACHINERY_DIRS = [
  '.claude',
  '.claude/hooks',
  '.claude/git-hooks',
  '.claude/state',
  '.claude/authority',
  '.claude/trust',
  '.claude/config',
  '.claude/certification',
  '.claude/scripts',
];

const HARNESS_PKG_NAME = 'claude-harness-eng-v5';

function isHarnessRepo(projectDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    return pkg.name === HARNESS_PKG_NAME;
  } catch (_) {
    return false;
  }
}

// Returns the project-relative path when filePath is protected machinery,
// null otherwise. Paths outside the project are the scope check's concern.
function machineryViolation(projectDir, filePath) {
  const rel = path.relative(projectDir, filePath).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;
  return MACHINERY.some((re) => re.test(rel)) ? rel : null;
}

/**
 * The project-relative path when removing `dirPath` would remove machinery it
 * CONTAINS, else null. Distinct from machineryViolation, which asks whether the
 * path IS machinery.
 */
function machineryAncestor(projectDir, dirPath) {
  const rel = path.relative(projectDir, dirPath).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return null; // outside the project
  return MACHINERY_DIRS.includes(rel) ? rel : null;
}

module.exports = { isHarnessRepo, machineryViolation, machineryAncestor };
