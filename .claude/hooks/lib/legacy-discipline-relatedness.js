'use strict';

// Gap G29 (Gap B) relatedness signal for legacy-discipline-gate.js. Replaces
// the old single commit-wide "any test-shaped file staged anywhere" boolean
// with a per-file check, tiered from most to least precise:
//   1. component-map.md story ownership: the uncovered production file and
//      the staged test file must belong to the SAME story. Reuses
//      parseComponentMapStoryFiles from impact-scope.js (gap G16) — the
//      codebase's existing story -> files parser, already reused for exactly
//      this "which story owns this file" question by at-first-gate.js (G23)
//      — rather than reinventing it.
//   2. naming-convention heuristic (component-map.md absent, or present but
//      silent on this particular file): matching basename with test/spec
//      markers stripped, e.g. src/b.py <-> tests/test_b.py.
//   3. commit-wide fallback: the old "a test-shaped file is staged
//      somewhere" behavior, kept as a last resort and NOTED as unverified —
//      per gap G29's design goal, this must not silently block everything
//      (no signal at all would otherwise BLOCK every legacy edit) or
//      silently pass everything (that was the bug being fixed).

const path = require('path');
const { parseComponentMapStoryFiles } = require('./impact-scope');

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

// file -> set of stories that own it in component-map.md (exact path or an
// owned directory prefix — mirrors at-first-gate.js's resolveStory).
function storyOwnersFor(file, mapText) {
  const f = normalize(file);
  const owners = new Set();
  for (const [story, files] of parseComponentMapStoryFiles(mapText)) {
    for (const raw of files) {
      const owned = normalize(raw).replace(/\/+$/, '');
      if (f === owned || f.startsWith(`${owned}/`)) owners.add(story);
    }
  }
  return owners;
}

function stripTestMarkers(base) {
  return base.replace(/^test_/, '').replace(/_test$/, '').replace(/\.(test|spec)$/, '');
}

function basenameKey(file) {
  const ext = path.extname(file);
  return stripTestMarkers(path.basename(file, ext)).toLowerCase();
}

// A single leading container-style directory (src/, tests/, __tests__/, ...)
// is the standard parallel-test-directory convention and must NOT be
// required to match — everything past it is the module's real location and
// SHOULD match, so two files sharing a basename in unrelated modules
// (src/foo/utils.py vs tests/bar/test_utils.py) are not misclassified.
const CONTAINER_DIRS = new Set(['src', 'lib', 'app', 'test', 'tests', '__tests__', 'spec', 'specs']);

function significantDir(file) {
  const parts = path.dirname(normalize(file)).split('/').filter((p) => p && p !== '.');
  if (parts.length && CONTAINER_DIRS.has(parts[0].toLowerCase())) parts.shift();
  return parts.join('/').toLowerCase();
}

// Same stripped basename AND the same directory beneath a leading test/src
// container, e.g. src/b.py <-> tests/test_b.py <-> src/b.test.ts (both at
// the container root), or src/foo/b.py <-> tests/foo/test_b.py (both under
// "foo") — but NOT src/foo/b.py <-> tests/bar/test_b.py ("foo" vs "bar").
function namingRelated(prodFile, testFile) {
  return basenameKey(prodFile) === basenameKey(testFile) && significantDir(prodFile) === significantDir(testFile);
}

function componentMapVerdict(prodFile, testFiles, mapText) {
  const prodOwners = storyOwnersFor(prodFile, mapText);
  if (prodOwners.size === 0) return null; // map has no opinion on this file
  const related = testFiles.some((t) => {
    const testOwners = storyOwnersFor(t, mapText);
    return [...testOwners].some((s) => prodOwners.has(s));
  });
  return { related, tier: 'component-map' };
}

function fallbackNote(prodFile, mapText) {
  return (
    `relatedness unverified for ${prodFile} — ` +
    `${mapText ? 'component-map.md has no story match for it' : 'no component-map.md exists'} ` +
    'and no naming/dir match either; falling back to "a test-shaped file is staged somewhere in ' +
    'this commit" (gap G29 disclosed fallback — see HARNESS.md).'
  );
}

// Returns {related, tier, note?}. testFiles: staged test-shaped files (any
// git status). mapText: component-map.md contents, or null/undefined if the
// project has none yet.
function hasRelatedEvidence(prodFile, testFiles, mapText) {
  if (!testFiles.length) return { related: false, tier: null };
  if (mapText) {
    const verdict = componentMapVerdict(prodFile, testFiles, mapText);
    if (verdict) return verdict;
  }
  if (testFiles.some((t) => namingRelated(prodFile, t))) {
    return { related: true, tier: 'naming-heuristic' };
  }
  return { related: true, tier: 'commit-wide-fallback', note: fallbackNote(prodFile, mapText) };
}

module.exports = { hasRelatedEvidence, storyOwnersFor, namingRelated };
