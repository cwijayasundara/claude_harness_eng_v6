'use strict';

// Pure hunk-range parser for `git diff --cached -U0 <path-filter>` output —
// gap G29, closing legacy-discipline-gate.js's disclosed Gap A (receipt
// matching was file-level, not symbol/line-range). No existing hunk parser
// was found elsewhere in this repo to reuse: coverage-diff.js only needs
// which FILES changed (per-file coverage totals), not which LINES; hooks/lib
// /coverage-preflight.js's editedRanges works from an Edit tool's old_string
// against in-memory file content, not a git diff. This is new, minimal
// parsing — just enough to know which line ranges a staged diff touched.
//
// Returns NEW-file-side line ranges only, keyed by the new path (from the
// `+++ b/<path>` header) — receipts record symbol start/end against the
// current working tree, which is what the new side of a diff represents.
//
// A pure-deletion hunk (0 lines added) has no "+" lines to report a real
// range for; it is recorded as a single-point range at the hunk's new-side
// anchor line, a conservative approximation of "something changed
// immediately adjacent to here" — disclosed, not hidden (see HARNESS.md G29).

const FILE_HEADER_RE = /^\+\+\+ b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function hunkRange(hunkMatch) {
  const newStart = parseInt(hunkMatch[1], 10);
  const newLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
  if (newLines === 0) {
    const point = Math.max(newStart, 1);
    return [point, point];
  }
  return [newStart, newStart + newLines - 1];
}

// diffText: raw `git diff ... -U0` output. Returns Map<newPath, [[s,e], ...]>.
function parseUnifiedDiffRanges(diffText) {
  const ranges = new Map();
  let currentFile = null;
  for (const line of String(diffText || '').split('\n')) {
    const fileMatch = line.match(FILE_HEADER_RE);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!ranges.has(currentFile)) ranges.set(currentFile, []);
      continue;
    }
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch && currentFile) ranges.get(currentFile).push(hunkRange(hunkMatch));
  }
  return ranges;
}

module.exports = { parseUnifiedDiffRanges };
