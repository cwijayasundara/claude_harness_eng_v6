'use strict';

// Wires the harness-manifest honesty invariant into `npm test`: the guides/
// sensors registry that HARNESS.md renders must stay faithful to reality, so a
// stale or malformed entry fails CI instead of silently rotting.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const { validate, DEFAULT_MANIFEST } = require(path.join(
  REPO_ROOT, '.claude', 'scripts', 'validate-harness-manifest.js'
));

function loadManifest() {
  return JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8'));
}

test('harness-manifest.json is valid and every wired_at resolves', () => {
  const { errors, counts } = validate(loadManifest());
  assert.deepStrictEqual(errors, [], `manifest errors:\n${errors.join('\n')}`);
  assert.ok(counts.sensors > 0, 'expected at least one sensor');
  assert.ok(counts.guides > 0, 'expected at least one guide');
});

test('validator catches a broken wired_at reference', () => {
  const m = loadManifest();
  m.sensors.push({
    id: '__bogus__', axis: 'behaviour', type: 'computational',
    cadence: 'commit', status: 'active', wired_at: '.claude/does-not-exist.js',
  });
  const { errors } = validate(m);
  assert.ok(
    errors.some((e) => e.includes('__bogus__') && e.includes('does not exist')),
    'validator should flag a non-existent wired_at'
  );
});

test('validator requires planned entries to name a gap', () => {
  const m = loadManifest();
  m.sensors.push({
    id: '__planned__', axis: 'behaviour', type: 'computational',
    cadence: 'drift', status: 'planned', wired_at: null,
  });
  const { errors } = validate(m);
  assert.ok(
    errors.some((e) => e.includes('__planned__') && e.includes('gap_ref')),
    'planned entry without gap_ref should fail'
  );
});

test('HARNESS.md exists and references the manifest', () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, 'HARNESS.md'), 'utf8');
  assert.ok(md.includes('harness-manifest.json'), 'HARNESS.md must reference the manifest');
});
