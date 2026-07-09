'use strict';

// Gap G29 Gap B: per-file/per-story relatedness signal replacing the old
// commit-wide "any test-shaped file staged" boolean in legacy-discipline-
// gate.js. Three tiers, most to least precise: component-map.md story
// ownership, naming-convention heuristic, commit-wide fallback (noted).

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { hasRelatedEvidence, storyOwnersFor, namingRelated } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'legacy-discipline-relatedness')
);

test('no staged test-shaped files at all -> not related, no tier', () => {
  const r = hasRelatedEvidence('src/b.py', [], null);
  assert.deepStrictEqual(r, { related: false, tier: null });
});

test('component-map.md: same story -> related', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/b.py`, `tests/test_b.py` |\n';
  const r = hasRelatedEvidence('src/b.py', ['tests/test_b.py'], mapText);
  assert.strictEqual(r.related, true);
  assert.strictEqual(r.tier, 'component-map');
});

test('component-map.md: different stories -> not related (a genuine negative signal)', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/b.py` |\n| E2-S2 | `tests/test_other.py` |\n';
  const r = hasRelatedEvidence('src/b.py', ['tests/test_other.py'], mapText);
  assert.strictEqual(r.related, false);
  assert.strictEqual(r.tier, 'component-map');
});

test('component-map.md exists but has no owner for the production file -> falls through to naming heuristic', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/unrelated.py` |\n';
  const r = hasRelatedEvidence('src/b.py', ['tests/test_b.py'], mapText);
  assert.strictEqual(r.related, true);
  assert.strictEqual(r.tier, 'naming-heuristic');
});

test('no component-map.md: naming heuristic matches stripped basenames', () => {
  const r = hasRelatedEvidence('src/b.py', ['tests/test_b.py'], null);
  assert.strictEqual(r.related, true);
  assert.strictEqual(r.tier, 'naming-heuristic');
  assert.strictEqual(namingRelated('src/b.py', 'tests/test_b.py'), true);
  assert.strictEqual(namingRelated('src/Foo.ts', 'src/Foo.test.ts'), true);
  assert.strictEqual(namingRelated('src/Foo.ts', '__tests__/Foo.spec.tsx'), true);
});

// Regression for the G29 review's CR-002: matching on stripped basename
// ALONE let two unrelated files sharing a basename across different
// subdirectories count as related (src/foo/utils.py <-> tests/bar/test_utils.py
// — same "utils" basename, but "foo" and "bar" are unrelated modules). The
// fix must not break the standard parallel-test-directory convention the
// tests above already rely on (src/ <-> tests/, src/ <-> __tests__/).
test('naming heuristic: same basename but different subdirectory beneath the test/src root -> NOT related', () => {
  assert.strictEqual(namingRelated('src/foo/utils.py', 'tests/bar/test_utils.py'), false);
});

test('naming heuristic: same basename AND same subdirectory beneath the test/src root -> related', () => {
  assert.strictEqual(namingRelated('src/foo/utils.py', 'tests/foo/test_utils.py'), true);
});

test('no component-map.md, no naming match: commit-wide fallback still passes, but records a note', () => {
  const r = hasRelatedEvidence('src/b.py', ['tests/test_unrelated_thing.py'], null);
  assert.strictEqual(r.related, true);
  assert.strictEqual(r.tier, 'commit-wide-fallback');
  assert.ok(r.note && r.note.includes('src/b.py'));
});

test('storyOwnersFor resolves both exact file matches and owned-directory prefixes', () => {
  const mapText = '| Story | Files |\n|---|---|\n| E1-S1 | `src/orders/` |\n| E2-S2 | `src/b.py` |\n';
  const owners = storyOwnersFor('src/orders/handler.py', mapText);
  assert.deepStrictEqual([...owners], ['E1-S1']);
  assert.deepStrictEqual([...storyOwnersFor('src/b.py', mapText)], ['E2-S2']);
  assert.strictEqual(storyOwnersFor('src/nowhere.py', mapText).size, 0);
});
