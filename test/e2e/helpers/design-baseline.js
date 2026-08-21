'use strict';

// Snapshot the living design so a sprint-N run can be proven to have AMENDED
// it rather than regenerated it.
//
// This is the one property the SPDD delta lane exists for, and the one the
// design skill's own Gotchas call out: "Never let Phase 3 regenerate
// specs/design/ from scratch... a rewritten architecture.md with no trace to
// the prior version". A regenerated design still produces every artifact a
// green route looks for, so artifact-existence checks cannot see the failure.
// Identity can: whatever the baseline named must still be named afterwards.
//
// Two signals, both format-independent:
//   - design-traces.json entry ids — structured, renderer-independent
//   - `## ` headings in component-map.md / architecture.md — present whether
//     the renderer emits prose sections or tables
//
// An empty snapshot would make every preservation assertion pass vacuously, so
// callers must assert the baseline is non-empty; `isEmpty` exists to make that
// one call rather than three.

const fs = require('fs');
const path = require('path');

function readText(root, ...rel) {
  try { return fs.readFileSync(path.join(root, ...rel), 'utf8'); }
  catch (_) { return ''; }
}

/** `## Heading` lines, normalised for whitespace. */
function headings(markdown) {
  return (markdown.match(/^##[^#\n].*$/gm) || [])
    .map((h) => h.replace(/^##\s*/, '').trim())
    .filter(Boolean);
}

function traceIds(root) {
  try {
    const parsed = JSON.parse(readText(root, 'specs', 'design', 'design-traces.json'));
    const entries = Array.isArray(parsed) ? parsed : (parsed && parsed.entries) || [];
    return entries.map((e) => e && e.id).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function snapshotDesign(root) {
  return {
    traceIds: traceIds(root),
    componentHeadings: headings(readText(root, 'specs', 'design', 'component-map.md')),
    architectureHeadings: headings(readText(root, 'specs', 'design', 'architecture.md')),
  };
}

function isEmpty(snapshot) {
  return snapshot.traceIds.length === 0
    && snapshot.componentHeadings.length === 0
    && snapshot.architectureHeadings.length === 0;
}

/** What the baseline named that the amended design no longer names. */
function missingFrom(before, after) {
  const gone = (a, b) => {
    const have = new Set(b);
    return a.filter((x) => !have.has(x));
  };
  return {
    traceIds: gone(before.traceIds, after.traceIds),
    componentHeadings: gone(before.componentHeadings, after.componentHeadings),
    architectureHeadings: gone(before.architectureHeadings, after.architectureHeadings),
  };
}

function anyMissing(diff) {
  return diff.traceIds.length > 0
    || diff.componentHeadings.length > 0
    || diff.architectureHeadings.length > 0;
}

module.exports = { snapshotDesign, missingFrom, anyMissing, isEmpty, headings };
