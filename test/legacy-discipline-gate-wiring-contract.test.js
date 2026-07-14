'use strict';

// Locks the G17 legacy-discipline-proof wiring: the recorder + gate scripts
// exist, are hard-wired into .claude/git-hooks/pre-commit as a default-on
// block, are registered active in harness-manifest.json, are reflected in
// HARNESS.md's Behaviour row + "current holes" ledger, are classified as
// hard-block in the sensor-arbitration policy, and checking-coverage-
// before-change's Step 2 pipes through the recorder.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('legacy-discipline-gate.js and record-coverage-verdict.js exist and reuse existing classification', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/legacy-discipline-gate.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/record-coverage-verdict.js')));
  const gate = read('.claude/scripts/legacy-discipline-gate.js');
  assert.match(gate, /require\('\.\/ownership-check'\)/, 'gate must reuse ownership-check.js\'s isSource, not reinvent it');
  assert.match(gate, /hooks.*lib.*tdd/, 'gate must reuse hooks/lib/tdd.js\'s isTestFile, not reinvent it');
});

test('pre-commit hard-wires the legacy-discipline gate into the registry as a default-on block', () => {
  // PR3 moved dispatch from the pre-commit script itself into gate-registry.js's
  // declarative GATE_CATALOG — assert against the real catalog, not prose.
  const { GATE_CATALOG } = require('../.claude/hooks/lib/gate-registry.js');
  const { GATE_TIERS } = require('../.claude/hooks/lib/sensor-tier.js');
  const legacy = require('../.claude/hooks/lib/gates-legacy.js');

  const entry = GATE_CATALOG.find((g) => g.id === 'legacy-discipline-proof');
  assert.ok(entry, 'GATE_CATALOG must register legacy-discipline-proof');
  assert.strictEqual(entry.run, legacy.checkLegacyDisciplineGate, 'must dispatch to the real gate function, not a copy');
  assert.ok(GATE_TIERS['legacy-discipline-proof'] && GATE_TIERS['legacy-discipline-proof'].has('standard'), 'must be enabled in the default "standard" tier');

  const gates = read('.claude/hooks/lib/gates-legacy.js');
  assert.match(gates, /HARNESS_LEGACY_DISCIPLINE_GATE/, 'must expose the documented escape hatch');
  assert.doesNotMatch(
    gates.slice(0, gates.indexOf('function checkLegacyDisciplineGate')),
    /legacy-discipline-gate/,
    'must NOT eagerly require the sensor script at module load (would crash the hook if the script is absent, unlike the lazy requireScript pattern)'
  );
});

test('checking-coverage-before-change Step 2 pipes coverage_map.py through the recorder', () => {
  const skill = read('.claude/skills/checking-coverage-before-change/SKILL.md');
  assert.match(skill, /coverage_map\.py[\s\S]*record-coverage-verdict\.js/, 'Step 2 must pipe through the recorder');
});

test('manifest registers legacy-discipline-proof active, behaviour axis, artifacts scope, commit cadence, G17', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'legacy-discipline-proof');
  assert.ok(s, 'legacy-discipline-proof sensor must be registered');
  assert.strictEqual(s.axis, 'behaviour');
  assert.strictEqual(s.type, 'computational');
  assert.strictEqual(s.cadence, 'commit');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'artifacts');
  assert.strictEqual(s.gap_ref, 'G17');
  assert.strictEqual(s.wired_at, '.claude/scripts/legacy-discipline-gate.js');
  assert.ok(fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
  assert.ok(s.signal && s.description, 'signal/description must be populated per the existing style');
});

test('HARNESS.md documents G17 in the Behaviour row and the current-holes ledger', () => {
  const harness = read('HARNESS.md');
  assert.match(harness, /legacy-discipline-proof/);
  assert.match(harness, /G17/);
});

test('sensor-arbitration.md classifies legacy-discipline-proof as hard-block with waiver guidance', () => {
  const doc = read('docs/sensor-arbitration.md');
  assert.match(doc, /legacy-discipline-proof/);
  assert.match(doc, /hard-block/);
  const g17Start = doc.indexOf('## Worked Classification: `legacy-discipline-proof`');
  assert.ok(g17Start !== -1);
  assert.match(doc.slice(g17Start), /sensor-waivers\.json/);
});

test('harness-manifest.json itself remains internally valid (honesty invariant)', () => {
  const { validate } = require('../.claude/scripts/validate-harness-manifest.js');
  const manifest = JSON.parse(read('harness-manifest.json'));
  const { errors } = validate(manifest);
  assert.deepStrictEqual(errors, []);
});
