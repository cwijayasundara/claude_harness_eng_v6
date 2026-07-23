'use strict';

// Phase 2: Project Zero readiness ratchet is wired into CI and must pass locally.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('CI workflow hard-fails agent-readiness ratchet', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /agent-readiness:assert/);
  assert.match(yml, /Agent readiness ratchet/i);
});

test('package.json exposes baseline + retention scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['agent-readiness:baseline']);
  assert.ok(pkg.scripts.retention);
  assert.ok(pkg.scripts['retention:dry']);
});

// The LIVE ratchet is deliberately NOT asserted here.
//
// agent-readiness measures the live repo (specs/, .claude/state/), and node --test runs
// this file in parallel with tests that write those same paths. The assertion reported
// "active pillars regressed: N < 8" on roughly one run in three, while the identical
// computation returns 8/8 in isolation. Isolating the output artifact did not help — the
// shared state is the INPUT — and there is no way to assert a property of the live repo
// from inside a suite that is concurrently mutating it.
//
// Enforcement moved rather than dropped: ci.yml runs "Agent readiness ratchet
// (Project Zero)" as its own step outside npm test and hard-fails on regression. The
// first test in this file asserts that wiring exists, which is what this file's header
// says it is for.
//
// Removal waived under specs/reviews/sensor-waivers.json (test-deletion-guard),
// approved by a human — see that file for the full rationale and expiry.
//
// Check it locally:  npm run agent-readiness && npm run agent-readiness:assert
