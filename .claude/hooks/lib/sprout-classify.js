'use strict';

// Gap G30: sprout-vs-pin-down classifier for sprout-diff-gate.js. Reuses
// legacy-discipline-relatedness.js's storyOwnersFor (gap G29) rather than
// reimplementing component-map.md story lookup — see that file's header for
// the tier rationale this mirrors.
//
// A SPROUT commit adds a genuinely NEW production file alongside a minimal
// legacy-file touch (sprouting-instead-of-editing) — the one-symbol check
// this classifier feeds only applies there. A PIN-DOWN commit
// (pinning-down-behavior) only adds/modifies TEST files, no new production
// file, and has no one-symbol constraint of its own; this classifier's only
// job is telling the two apart so the stricter check applies to the right
// commit shape.

const { storyOwnersFor } = require('./legacy-discipline-relatedness');

function fallbackNote(legacyFile) {
  return (
    `sprout-diff: no component-map.md story link between ${legacyFile} and the newly added ` +
    'production file(s) in this commit — falling back to "a new production file was staged ' +
    "somewhere in this commit\" (gap G30 disclosed fallback tier, mirroring gap G29's relatedness fallback)."
  );
}

function componentMapSproutVerdict(legacyFile, addedProdFiles, mapText) {
  const legacyOwners = storyOwnersFor(legacyFile, mapText);
  if (legacyOwners.size === 0) return null; // map has no opinion on the legacy file
  const related = addedProdFiles.some((f) => {
    const owners = storyOwnersFor(f, mapText);
    return [...owners].some((s) => legacyOwners.has(s));
  });
  // A definitive verdict (even a negative one) short-circuits classifySprout
  // rather than falling through to the fallback tier — mirroring
  // legacy-discipline-relatedness.js's componentMapVerdict, which returns
  // {related: false, ...} rather than null on a definitive story mismatch.
  // Without this, a map that explicitly assigns the added file to an
  // UNRELATED story was indistinguishable from "map has no opinion at all",
  // over-classifying legitimate cross-story commits as sprouts.
  return { isSprout: related, tier: 'component-map' };
}

// legacyFile: the UNCOVERED-with-evidence legacy file under test.
// addedProdFiles: staged, added (diff-filter=A), source, non-test files in
// this commit. mapText: component-map.md contents, or null/undefined if the
// project has none yet. Returns {isSprout, tier, note?}.
function classifySprout(legacyFile, addedProdFiles, mapText) {
  if (!addedProdFiles.length) return { isSprout: false, tier: null };
  if (mapText) {
    const verdict = componentMapSproutVerdict(legacyFile, addedProdFiles, mapText);
    if (verdict) return verdict;
  }
  return { isSprout: true, tier: 'commit-wide-fallback', note: fallbackNote(legacyFile) };
}

module.exports = { classifySprout };
