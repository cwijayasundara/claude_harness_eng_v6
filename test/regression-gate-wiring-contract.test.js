'use strict';

// Locks the G15 regression-suite-full wiring: the script exists, is exposed
// as an npm script, is hard-wired into every lane that can actually merge
// work into shared history (/gate pre-merge, /auto's pre-merge-to-WAVE_BASE
// step), is registered active in harness-manifest.json, is reflected in
// HARNESS.md's Behaviour row + "current holes" ledger, and is classified as
// hard-block in the sensor-arbitration policy.
//
// As of gap G16, /change Step S5 and /vibe Step 6 run the faster impact-
// scoped-regression sensor (local-regression-gate.js) instead of this full
// sweep on every iteration — see local-regression-gate-wiring-contract.test.js
// for that half. G15's full sweep remains the mandatory merge-time backstop.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('regression-gate CLI exists and reuses the hooks/lib machinery', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/regression-gate.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/regression-gate.js')));
  const cli = read('.claude/scripts/regression-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/regression-gate'\)/, 'CLI must reuse the tested lib');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/contract-schema'\)/, 'CLI must reuse validate-contract.js\'s schema machinery');
});

test('package.json exposes the regression-gate script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['regression-gate'], 'node .claude/scripts/regression-gate.js');
});

test('/gate runs regression-gate.js as a pre-merge hard block', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /regression-gate\.js/, '/gate must run the regression-suite-full gate');
});

test('/change Step S5 no longer requires the full regression-gate.js sweep (moved to G16 for local iteration)', () => {
  const skill = read('.claude/skills/change/SKILL.md');
  const s5Start = skill.indexOf('### Step S5');
  const s5End = skill.indexOf('### Step S6');
  assert.ok(s5Start !== -1 && s5End !== -1 && s5End > s5Start, 'Step S5/S6 headings must exist');
  const s5 = skill.slice(s5Start, s5End);
  assert.match(s5, /local-regression-gate\.js/, 'Step S5 must run the fast impact-scoped gate (G16)');
  assert.match(s5, /full test suite/, 'Step S5 must still run the full unit suite');
});

test('/auto runs regression-gate.js before merging a group/wave/cluster into WAVE_BASE', () => {
  const skill = read('.claude/skills/auto/SKILL.md');
  assert.match(skill, /regression-gate\.js/, '/auto must run the regression-suite-full gate before merge');
});

test('manifest registers regression-suite-full active, behaviour axis, runtime scope, G15', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'regression-suite-full');
  assert.ok(s, 'regression-suite-full sensor must be registered');
  assert.strictEqual(s.axis, 'behaviour');
  assert.strictEqual(s.type, 'computational');
  assert.ok(['integration', 'commit'].includes(s.cadence));
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'runtime');
  assert.strictEqual(s.gap_ref, 'G15');
  assert.strictEqual(s.wired_at, '.claude/scripts/regression-gate.js');
  assert.ok(fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
  assert.ok(s.signal && s.description, 'signal/description must be populated per the existing style');
});

test('HARNESS.md documents G15 in the Behaviour row and the current-holes ledger', () => {
  const harness = read('HARNESS.md');
  assert.match(harness, /regression-suite-full|regression[- ]gate/i);
  assert.match(harness, /G15/);
});

test('sensor-arbitration.md classifies regression-suite-full as hard-block with waiver guidance', () => {
  const doc = read('docs/sensor-arbitration.md');
  assert.match(doc, /regression-suite-full/);
  assert.match(doc, /hard-block/);
});

test('harness-manifest.json itself remains internally valid (honesty invariant)', () => {
  const { validate } = require('../.claude/scripts/validate-harness-manifest.js');
  const manifest = JSON.parse(read('harness-manifest.json'));
  const { errors } = validate(manifest);
  assert.deepStrictEqual(errors, []);
});
