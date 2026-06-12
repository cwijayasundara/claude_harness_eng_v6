'use strict';

// Harness machinery the model must not edit mid-run: the hooks and git hooks
// that implement the quality gates, the settings that wire them, the security
// patterns they enforce, and the gate state (coverage baselines, review
// queue, error log). An agent that can rewrite its own gates passes them
// trivially — evaluator-side tampering is the dominant spontaneous integrity
// failure documented for coding agents. Machinery changes belong to the human:
// made in the harness repo (detected via package.json name) or under an
// explicit HARNESS_PROTECT=off.
// Limitation: this guards the Write/Edit/MultiEdit path only — file writes
// via Bash do not pass the pre-write gate.

const fs = require('fs');
const path = require('path');

const MACHINERY = [
  /^\.claude\/hooks\//,
  /^\.claude\/git-hooks\//,
  /^\.claude\/settings(\.local)?\.json$/,
  /^\.claude\/security-patterns\.(json|ya?ml)$/,
  /^\.claude\/state\/(coverage-baseline[^/]*|coverage-preflight-cache\.json|review-block-count|hook-errors\.(log|offset)|pending-reviews\.jsonl)$/,
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

module.exports = { isHarnessRepo, machineryViolation };
