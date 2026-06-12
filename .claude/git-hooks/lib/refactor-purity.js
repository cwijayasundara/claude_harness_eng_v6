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

// Does the subject line claim a behavior-preserving (refactor) commit?
// Three forms, widest-to-narrowest, chosen to avoid false positives:
// - refactor-family conventional prefix: "refactor:", "rename(auth):", "extract!:"
// - bare unambiguous structural verb as the first word: "restructure auth module"
//   (bare "move"/"extract"/"rename" are excluded — they are common domain verbs:
//   "move button to header" is a behavior change)
// - chore/style prefix whose description contains a structural verb:
//   "chore: rename UserService to AccountService"
//   (fix/feat prefixes never match — those legitimately touch tests)
const REFACTOR_PREFIX_RE = /^(refactor|cleanup|rename|move|extract)(\(|:|!)/i;
const BARE_STRUCTURAL_RE = /^(refactor|restructure|reorgani[sz]e)\b/i;
const CHORE_PREFIX_RE = /^(chore|style)(\([^)]*\))?!?:\s*(.*)$/i;
const STRUCTURAL_VERB_RE = /\b(refactor|renam(?:e|es|ed|ing)|restructur(?:e|es|ed|ing)|reorgani[sz](?:e|es|ed|ing)|extract(?:s|ed|ing)?|inlin(?:e|es|ed|ing)|tidy(?:ing)?(?:\s+up)?|clean(?:s|ed|ing)?\s?up|mov(?:e|es|ed|ing)\s+\S+(\s+\S+)?\s+(?:to|into)\b)/i;

function claimsRefactor(subject) {
  const s = subject.trim();
  if (REFACTOR_PREFIX_RE.test(s) || BARE_STRUCTURAL_RE.test(s)) return true;
  const chore = s.match(CHORE_PREFIX_RE);
  return Boolean(chore && STRUCTURAL_VERB_RE.test(chore[3]));
}

module.exports = { findImpureFiles, claimsRefactor, SNAPSHOT_RE };
