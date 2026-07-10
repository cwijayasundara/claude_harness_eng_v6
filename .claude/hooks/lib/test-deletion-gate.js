'use strict';

// Test-deletion / skip guard (gap G31). Behaviour-preservation gates (G7
// mutation-gate, G17 legacy-discipline, G30 sprout-diff) all prove a change
// didn't silently regress PRODUCTION code; nothing caught a refactor or
// dependency bump making its own suite pass by deleting, or newly skipping,
// an inconvenient test instead of fixing it. Pure content-diff logic only —
// git plumbing lives in scripts/test-deletion-gate.js (same split
// cycle-gate.js / legacy-discipline-gate.js already use).
//
// Heuristic, regex-based counting (same tier as secrets.js's baseline scan
// and tdd.js's isTestFile) — not an AST parse. False positives/negatives on
// pathological formatting are possible; the signal is "the count moved the
// wrong way", not a precise test inventory.

const TEST_MARKER_RE = /\b(?:it|test)(?:\.each)?\s*\(|^\s*(?:async\s+)?def\s+test_\w+/gm;
const SKIP_MARKER_RE = /\.(?:skip|todo)\s*\(|\bxit\s*\(|\bxdescribe\s*\(|\bxtest\s*\(|@pytest\.mark\.skip\b|@unittest\.skip\b/g;

function countMatches(content, re) {
  const m = String(content || '').match(re);
  return m ? m.length : 0;
}

function countTestMarkers(content) {
  return countMatches(content, TEST_MARKER_RE);
}

function countSkipMarkers(content) {
  return countMatches(content, SKIP_MARKER_RE);
}

// oldContent === null means the file did not exist before this change (a
// brand-new test file) — nothing to lose, never a finding. newContent ===
// null means the file was deleted.
function classifyTestFileChange(file, oldContent, newContent) {
  if (oldContent === null) return null;
  const oldTests = countTestMarkers(oldContent);
  if (newContent === null) {
    if (oldTests === 0) return null; // nothing test-shaped lived in this file
    return { file, kind: 'deleted', oldTests, newTests: 0 };
  }
  const newTests = countTestMarkers(newContent);
  if (newTests < oldTests) {
    return { file, kind: 'count-decreased', oldTests, newTests };
  }
  const oldSkips = countSkipMarkers(oldContent);
  const newSkips = countSkipMarkers(newContent);
  if (newSkips > oldSkips) {
    return { file, kind: 'new-skip', oldSkips, newSkips };
  }
  return null;
}

// changes: [{file, oldContent, newContent}] -> findings only (nulls dropped).
function classifyTestFileChanges(changes) {
  return changes
    .map((c) => classifyTestFileChange(c.file, c.oldContent, c.newContent))
    .filter(Boolean);
}

module.exports = {
  countTestMarkers,
  countSkipMarkers,
  classifyTestFileChange,
  classifyTestFileChanges,
};
