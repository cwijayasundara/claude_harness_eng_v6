'use strict';

// Locks the G23 at-first-proof wiring: the recorder + gate scripts exist, are
// hard-wired into .claude/git-hooks/pre-commit as a default-on block, are
// registered active in harness-manifest.json, are reflected in HARNESS.md's
// Behaviour row + "current holes" ledger (narrowing G20's own entry), are
// classified as hard-block in the sensor-arbitration policy, and
// writing-acceptance-tests-first's Process step 5 pipes through the recorder.
// Mirrors test/legacy-discipline-gate-wiring-contract.test.js (G17).

const { test } = require('node:test');
const { shipsIn } = require('./helpers/pack-membership');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('at-first-gate.js and record-at-red.js exist and reuse existing classification', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/at-first-gate.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/record-at-red.js')));
  const gate = read('.claude/scripts/at-first-gate.js');
  assert.match(gate, /require\('\.\/ownership-check'\)/, "gate must reuse ownership-check.js's isSource, not reinvent it");
  assert.match(gate, /hooks.*lib.*tdd/, "gate must reuse hooks/lib/tdd.js's isTestFile, not reinvent it");
  assert.match(gate, /hooks.*lib.*impact-scope/, "gate must reuse hooks/lib/impact-scope.js's parseComponentMapStoryFiles, not reinvent story ownership");
});

test('pre-commit hard-wires the at-first gate into the registry as a default-on block', () => {
  // PR3 moved dispatch from the pre-commit script itself into gate-registry.js's
  // declarative GATE_CATALOG — assert against the real catalog, not prose.
  const { GATE_CATALOG } = require('../.claude/hooks/lib/gate-registry.js');
  const { GATE_TIERS } = require('../.claude/hooks/lib/sensor-tier.js');
  const legacy = require('../.claude/hooks/lib/gates-legacy.js');

  const entry = GATE_CATALOG.find((g) => g.id === 'at-first-gate');
  assert.ok(entry, 'GATE_CATALOG must register the at-first-gate');
  // The catalog now dispatches through packRun (gates-legacy is pack-owned and lazily
  // required), so reference identity no longer holds. Assert the property that identity
  // was standing in for: invoking entry.run reaches the REAL gate function, not a stub.
  let reached = false;
  const original = legacy.checkAtFirstGate;
  legacy.checkAtFirstGate = () => { reached = true; };
  try {
    entry.run({ projectDir: ROOT, stagedSource: [], staged: [] });
  } finally {
    legacy.checkAtFirstGate = original;
  }
  assert.ok(reached, 'entry.run must dispatch to gates-legacy.checkAtFirstGate, not a copy or a no-op');
  assert.ok(GATE_TIERS['at-first-gate'] && GATE_TIERS['at-first-gate'].has('standard'), 'must be enabled in the default "standard" tier');

  const gates = read('.claude/hooks/lib/gates-legacy.js');
  assert.match(gates, /HARNESS_AT_FIRST_GATE/, 'must expose the documented escape hatch');
  // The property that matters is that the sensor script is NOT required at MODULE
  // SCOPE — a top-level require would crash the whole hook when the script is absent.
  // Asserted directly: the previous version checked that the name did not appear
  // before a given function, which broke the moment a helper was extracted even
  // though the loading behaviour was unchanged.
  const topLevel = gates.split('\n').filter((l) => /^const .*require\(/.test(l)).join('\n');
  assert.doesNotMatch(topLevel, /at-first-gate/,
    'must NOT eagerly require the sensor script at module load — requireScript is called lazily inside the gate');
});

test('writing-acceptance-tests-first Process step 5 pipes the AT run through the recorder', () => {
  const skill = read('.claude/skills/writing-acceptance-tests-first/SKILL.md');
  assert.match(skill, /record-at-red\.js/, 'Process step 5 must run the AT through the recorder');
});

test('manifest registers at-first-proof active, behaviour axis, artifacts scope, commit cadence, G23', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'at-first-proof');
  assert.ok(s, 'at-first-proof sensor must be registered');
  assert.strictEqual(s.axis, 'behaviour');
  assert.strictEqual(s.type, 'computational');
  assert.strictEqual(s.cadence, 'commit');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'artifacts');
  assert.strictEqual(s.gap_ref, 'G23');
  assert.strictEqual(s.wired_at, '.claude/scripts/at-first-gate.js');
  assert.ok(fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
  assert.ok(s.signal && s.description, 'signal/description must be populated per the existing style');
});

test('HARNESS.md documents G23 in the Behaviour row and the current-holes ledger, and narrows G20', () => {
  const harness = read('HARNESS.md');
  assert.match(harness, /at-first-proof/);
  assert.match(harness, /\*\*G23\*\*/);
  const g20Start = harness.indexOf('**G20**');
  assert.ok(g20Start !== -1);
  assert.match(harness.slice(g20Start, g20Start + 2000), /G23/, "G20's own entry must reference G23 the way G15's entry references G16");
});

test('sensor-arbitration.md classifies at-first-proof as hard-block with waiver guidance', () => {
  const doc = read('docs/sensor-arbitration.md');
  assert.match(doc, /at-first-proof/);
  const g23Start = doc.indexOf('## Worked Classification: `at-first-proof`');
  assert.ok(g23Start !== -1);
  const section = doc.slice(g23Start);
  assert.match(section, /hard-block/);
  assert.match(section, /sensor-waivers\.json/);
});

test('both scripts ship to a scaffolded project', () => {
  for (const name of ['at-first-gate', 'record-at-red']) {
    assert.ok(shipsIn(name, 'script').includes('core'), `${name} must ship in the core profile`);
  }
});

test('harness-manifest.json itself remains internally valid (honesty invariant)', () => {
  const { validate } = require('../.claude/scripts/validate-harness-manifest.js');
  const manifest = JSON.parse(read('harness-manifest.json'));
  const { errors } = validate(manifest);
  assert.deepStrictEqual(errors, []);
});
