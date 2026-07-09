'use strict';

// Gap G30: pure symbol-range overlap arithmetic for sprout-diff-gate.js —
// mechanically verifies sprouting-instead-of-editing's Iron Law ("touch the
// legacy file at exactly one call line, or the rename pair for wrap")
// against code-graph.json's per-file `symbols` records (code_index.py),
// the same records coverage_map.py's symbol_rows already flattens for the
// legacy-discipline-gate.js (G17/G29) receipt check this composes with.
//
// Scoping choice (disclosed, not hidden — see HARNESS.md G30): a class's own
// top-level range is only a leaf symbol when it has NO methods. When it has
// methods, only the methods are leaves — a change inside one method counts
// once, against that method, not twice against the method AND its enclosing
// class (every method's range sits inside its class's range, so any overlap
// check against both would always double-count a single-method edit). The
// trade-off is a rare miss: a change to class-level code that sits between
// methods (e.g. a class attribute or decorator) is invisible to this check,
// since no leaf symbol's range covers it. That is judged the better default
// than the much more common false positive it avoids.

// Flattens one file's `symbols` array (code_index.py shape: {name, kind,
// start, end, children?}) to its addressable leaf units.
function leafSymbols(fileRecord) {
  const leaves = [];
  for (const sym of (fileRecord && fileRecord.symbols) || []) {
    if (Array.isArray(sym.children) && sym.children.length > 0) {
      for (const child of sym.children) {
        leaves.push({ name: `${sym.name}.${child.name}`, start: child.start, end: child.end });
      }
    } else {
      leaves.push({ name: sym.name, start: sym.start, end: sym.end });
    }
  }
  return leaves;
}

function overlaps(range, start, end) {
  return range[0] <= end && range[1] >= start;
}

// ranges: [[s,e], ...] changed line ranges for this file, or null when
// unknown (e.g. --files CLI mode with no git diff plumbing — mirrors
// diff-hunks.js/legacy-discipline-gate.js's own null-means-unknown
// convention). Returns the sorted, deduplicated list of distinct leaf-symbol
// names whose range overlaps ANY changed range — null propagates so the
// caller can tell "unverifiable" apart from "verified, zero symbols touched".
function symbolsTouchedByRanges(fileRecord, ranges) {
  if (ranges === null) return null;
  const leaves = leafSymbols(fileRecord);
  const touched = new Set();
  for (const range of ranges) {
    for (const leaf of leaves) {
      if (overlaps(range, leaf.start, leaf.end)) touched.add(leaf.name);
    }
  }
  return [...touched].sort();
}

module.exports = { leafSymbols, symbolsTouchedByRanges };
