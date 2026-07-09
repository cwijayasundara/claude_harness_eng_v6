'use strict';

// Locks the G18 coupling-fail wiring.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('coupling-gate CLI reuses the lib and is require-safe', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/coupling-gate.js')));
  const cli = read('.claude/scripts/coupling-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/coupling-gate'\)/, 'CLI must use the tested lib');
});

test('coupling-gate lib reuses drift.js and cycle-gate.js instead of reimplementing', () => {
  const lib = read('.claude/hooks/lib/coupling-gate.js');
  assert.match(lib, /require\('\.\/drift'\)/, 'must reuse unstableHubIds from drift.js');
  assert.match(lib, /require\('\.\/cycle-gate'\)/, 'must reuse gateDecision from cycle-gate.js');
});

test('package.json exposes the coupling-gate script; /auto Gate 4 and /gate run it', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['coupling-gate'], 'node .claude/scripts/coupling-gate.js');
  assert.match(read('.claude/skills/auto/SKILL.md'), /coupling-gate\.js/, 'Gate 4 must run the coupling ratchet');
  assert.match(read('.claude/skills/gate/SKILL.md'), /coupling-gate\.js/, '/gate must run the coupling ratchet');
});

test('manifest marks the coupling ratchet active and enforced on the architecture axis', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'coupling-ratchet');
  assert.ok(s, 'expected a coupling-ratchet sensor entry');
  assert.strictEqual(s.axis, 'architecture');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'repo');
  assert.strictEqual(s.wired_at, '.claude/scripts/coupling-gate.js');
  assert.strictEqual(s.gap_ref, 'G18');
});

test('coupling-report manifest entry is precise about what is now enforced vs advisory', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'coupling-report');
  assert.ok(s, 'expected the coupling-report sensor entry');
  assert.match(s.description, /coupling-gate\.js/, 'must reference the new commit-time ratchet');
  assert.match(s.description, /discovery-only/, 'must still note the rest of the report is discovery-only');
});

test('HARNESS.md documents G18 as closed and lists it in the Architecture row', () => {
  const md = read('HARNESS.md');
  assert.match(md, /G18/);
  assert.match(md, /coupling-gate\.js/);
});

test('docs/sensor-arbitration.md classifies the coupling ratchet as hard-block', () => {
  const doc = read('docs/sensor-arbitration.md');
  assert.match(doc, /coupling-ratchet/);
  assert.match(doc, /hard-block/);
});
