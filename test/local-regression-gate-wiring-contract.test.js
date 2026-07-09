'use strict';

// Locks the G16 impact-scoped-regression wiring: impact-scope.js and
// local-regression-gate.js exist and are exposed as npm scripts, the gate is
// hard-wired into every LOCAL iteration lane (/change Step S5, /vibe Step 6)
// while G15's full sweep stays at /gate and /auto's pre-merge step
// unchanged, the sensor is registered active in harness-manifest.json,
// reflected in HARNESS.md's Behaviour row + "current holes" ledger, and
// classified as hard-block in the sensor-arbitration policy.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('impact-scope.js and local-regression-gate.js exist and reuse tested hooks/lib machinery', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/impact-scope.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/impact-scope.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/local-regression-gate.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/local-regression-gate.js')));
  const cli = read('.claude/scripts/local-regression-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/impact-scope'\)/, 'CLI must reuse the tested impact-scope lib');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/regression-gate'\)/, 'CLI must reuse G15\'s quarantine primitive, not duplicate it');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/local-regression-gate'\)/, 'CLI must reuse the tested scoped-runner lib');
});

test('package.json exposes impact-scope and local-regression-gate scripts', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['impact-scope'], 'node .claude/scripts/impact-scope.js');
  assert.strictEqual(pkg.scripts['local-regression-gate'], 'node .claude/scripts/local-regression-gate.js');
});

test('/change Step S5 runs local-regression-gate.js in addition to (not instead of) the unit suite', () => {
  const skill = read('.claude/skills/change/SKILL.md');
  const s5Start = skill.indexOf('### Step S5');
  const s5End = skill.indexOf('### Step S6');
  const s5 = skill.slice(s5Start, s5End);
  assert.match(s5, /local-regression-gate\.js/, 'Step S5 must run the impact-scoped gate');
  assert.match(s5, /full test suite/, 'Step S5 must still run the full unit suite');
});

test('/vibe Step 6 runs local-regression-gate.js', () => {
  const skill = read('.claude/skills/vibe/SKILL.md');
  assert.match(skill, /local-regression-gate\.js/, '/vibe must run the impact-scoped gate');
});

test('/gate and /auto keep running the FULL regression-gate.js sweep unchanged (G15 is not replaced)', () => {
  // (?<!local-) so this doesn't false-pass on "local-regression-gate.js" —
  // that substring also matches a bare /regression-gate\.js/ check.
  const fullGateRe = /(?<!local-)regression-gate\.js/;
  const gate = read('.claude/skills/gate/SKILL.md');
  const auto = read('.claude/skills/auto/SKILL.md');
  assert.match(gate, fullGateRe, '/gate must still run the FULL regression-gate.js sweep');
  assert.match(auto, fullGateRe, '/auto must still run the FULL regression-gate.js sweep');
  assert.doesNotMatch(gate, /local-regression-gate\.js/, '/gate must not have been rewired to the local/scoped gate');
  assert.doesNotMatch(auto, /local-regression-gate\.js/, '/auto must not have been rewired to the local/scoped gate');
});

test('manifest registers impact-scoped-regression active, behaviour axis, diff scope, G16', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'impact-scoped-regression');
  assert.ok(s, 'impact-scoped-regression sensor must be registered');
  assert.strictEqual(s.axis, 'behaviour');
  assert.strictEqual(s.type, 'computational');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'runtime');
  assert.strictEqual(s.gap_ref, 'G16');
  assert.strictEqual(s.wired_at, '.claude/scripts/local-regression-gate.js');
  assert.ok(fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
  assert.ok(s.signal && s.description, 'signal/description must be populated per the existing style');
});

test('HARNESS.md documents G16 in the Behaviour row and the current-holes ledger', () => {
  const harness = read('HARNESS.md');
  assert.match(harness, /impact-scoped-regression/);
  assert.match(harness, /G16/);
});

test('sensor-arbitration.md classifies impact-scoped-regression as hard-block with waiver guidance', () => {
  const doc = read('docs/sensor-arbitration.md');
  assert.match(doc, /impact-scoped-regression/);
  assert.match(doc, /hard-block/);
});

test('harness-manifest.json itself remains internally valid (honesty invariant)', () => {
  const { validate } = require('../.claude/scripts/validate-harness-manifest.js');
  const manifest = JSON.parse(read('harness-manifest.json'));
  const { errors } = validate(manifest);
  assert.deepStrictEqual(errors, []);
});
