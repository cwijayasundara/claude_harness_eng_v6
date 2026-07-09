'use strict';

// Gap G30: sprout-vs-pin-down classifier for sprout-diff-gate.js. A SPROUT
// commit adds a genuinely NEW production file alongside a minimal legacy-
// file touch (sprouting-instead-of-editing) and IS subject to the one-symbol
// check; a PIN-DOWN commit (pinning-down-behavior) only adds/modifies TEST
// files — no new production file — and has no such constraint. This
// classifier's only job is telling the two apart, reusing
// legacy-discipline-relatedness.js's storyOwnersFor rather than
// reimplementing component-map.md story lookup.

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { classifySprout } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'sprout-classify')
);

test('no added production files at all -> not a sprout (pin-down territory)', () => {
  const r = classifySprout('src/legacy.py', [], null);
  assert.deepStrictEqual(r, { isSprout: false, tier: null });
});

test('component-map.md: added file shares a story with the legacy file -> sprout, component-map tier', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/legacy.py`, `src/new_unit.py` |\n';
  const r = classifySprout('src/legacy.py', ['src/new_unit.py'], mapText);
  assert.strictEqual(r.isSprout, true);
  assert.strictEqual(r.tier, 'component-map');
});

// Regression for the G30 review's CR-001: the map has a definitive opinion
// here (both files are owned, by DIFFERENT stories) so it must short-circuit
// to isSprout:false rather than falling through to the commit-wide fallback
// — a definitive non-relation is not the same as "map has no opinion at
// all" (that case is covered by the next test below).
test('component-map.md: added file is a DIFFERENT story -> not a sprout, component-map tier (definitive, no fallback)', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/legacy.py` |\n| E2-S2 | `src/new_unit.py` |\n';
  const r = classifySprout('src/legacy.py', ['src/new_unit.py'], mapText);
  assert.strictEqual(r.isSprout, false);
  assert.strictEqual(r.tier, 'component-map');
});

// Mirrors legacy-discipline-relatedness.js's own equivalent case: once the
// map has an opinion on the ANCHOR file (legacyFile), an added file it
// doesn't mention at all is treated the same as an added file it assigns to
// a different story — both are a definitive non-relation, not "no opinion".
// Only the legacy file itself having zero owners falls back further.
test('component-map.md: legacy file has an owning story but the added file is unmentioned -> not a sprout, component-map tier (definitive, no fallback)', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/legacy.py` |\n';
  const r = classifySprout('src/legacy.py', ['src/new_unit.py'], mapText);
  assert.strictEqual(r.isSprout, false);
  assert.strictEqual(r.tier, 'component-map');
});

test('component-map.md: legacy file itself has NO owner at all -> falls back to commit-wide', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/unrelated.py` |\n';
  const r = classifySprout('src/legacy.py', ['src/new_unit.py'], mapText);
  assert.strictEqual(r.isSprout, true);
  assert.strictEqual(r.tier, 'commit-wide-fallback');
  assert.ok(r.note && r.note.includes('src/legacy.py'));
});

test('no component-map.md at all -> commit-wide fallback, any added production file counts', () => {
  const r = classifySprout('src/legacy.py', ['src/new_unit.py'], null);
  assert.strictEqual(r.isSprout, true);
  assert.strictEqual(r.tier, 'commit-wide-fallback');
  assert.ok(r.note);
});
