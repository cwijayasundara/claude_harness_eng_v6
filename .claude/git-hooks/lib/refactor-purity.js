'use strict';

// Shared refactor-purity check — used by both the pre-commit hook (env-var
// path) and the commit-msg hook (subject-line detection path).
// A refactor commit changes no behavior: it must not touch tests or snapshots.

const path = require('path');
const { isTestFile } = require(path.join(__dirname, '..', '..', 'hooks', 'lib', 'tdd'));

const SNAPSHOT_RE = /(^|\/)__snapshots__\/|\.(snap|ambr|approved\.txt|received\.txt)$/;

// Returns an array of impure file paths. Empty array means the commit is pure.
function findImpureFiles(staged) {
  return staged.filter((f) => SNAPSHOT_RE.test(f) || isTestFile(f));
}

module.exports = { findImpureFiles, SNAPSHOT_RE };
