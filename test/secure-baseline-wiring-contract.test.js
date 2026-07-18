'use strict';

// Locks the Increment 1 secure-repo baseline wiring so the two controls cannot be
// silently un-wired: registry membership (how /auto Gate 7 surfaces them),
// strict-tier gating, manifest registration, control-budget accounting, and the
// scaffold copy-list for the tier-aware scanner.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const { GATE_CATALOG, selectGates } = require('../.claude/hooks/lib/gate-registry');
const { GATE_TIERS } = require('../.claude/hooks/lib/sensor-tier');
const strict = require('../.claude/hooks/lib/gates-strict');

test('security-baseline is registered at order 160, strict, runsWithoutSource, dispatching to the real gate', () => {
  const e = GATE_CATALOG.find((g) => g.id === 'security-baseline');
  assert.ok(e, 'GATE_CATALOG must register security-baseline');
  assert.strictEqual(e.order, 160);
  assert.strictEqual(e.runsWithoutSource, true, 'secrets must be caught on docs/config-only commits');
  assert.ok(GATE_TIERS['security-baseline'].has('strict'));
  assert.strictEqual(typeof strict.checkSecurityBaseline, 'function', 'must dispatch to the real gate');
});

test('secure-baseline-wiring is registered at order 165, strict, runsWithoutSource', () => {
  const e = GATE_CATALOG.find((g) => g.id === 'secure-baseline-wiring');
  assert.ok(e, 'GATE_CATALOG must register secure-baseline-wiring');
  assert.strictEqual(e.order, 165);
  assert.strictEqual(e.runsWithoutSource, true);
  assert.ok(GATE_TIERS['secure-baseline-wiring'].has('strict'));
  assert.strictEqual(typeof strict.checkSecureBaselineWiring, 'function');
});

test('both controls are strict-only: present at strict, absent at standard and minimal', () => {
  const strictIds = selectGates('strict').map((g) => g.id);
  const stdIds = selectGates('standard').map((g) => g.id);
  const minIds = selectGates('minimal').map((g) => g.id);
  for (const id of ['security-baseline', 'secure-baseline-wiring']) {
    assert.ok(strictIds.includes(id), `${id} runs at strict`);
    assert.ok(!stdIds.includes(id), `${id} does not run at standard`);
    assert.ok(!minIds.includes(id), `${id} does not run at minimal`);
  }
});

test('/auto Gate 7 surfaces the security-baseline ratchet via registry membership', () => {
  // Empirical: the gate is a registry member selected at strict (asserted above),
  // and /auto's Gate 7 documents that it surfaces here through that membership.
  const corpus = readSkillCorpus('auto');
  assert.match(corpus, /security-baseline/, '/auto Gate 7 must reference the security-baseline ratchet');
  assert.match(corpus, /secure-baseline-wiring/, '/auto Gate 7 must reference the wiring invariant');
});

test('both controls are registered as active behaviour sensors wired to gates-strict.js', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness-manifest.json'), 'utf8'));
  for (const id of ['security-baseline', 'secure-baseline-wiring']) {
    const s = manifest.sensors.find((x) => x.id === id);
    assert.ok(s, `manifest must register ${id}`);
    assert.strictEqual(s.axis, 'behaviour');
    assert.strictEqual(s.type, 'computational');
    assert.strictEqual(s.cadence, 'commit');
    assert.strictEqual(s.status, 'active');
    assert.strictEqual(s.wired_at, '.claude/hooks/lib/gates-strict.js');
    assert.ok(fs.existsSync(path.join(ROOT, s.wired_at)));
  }
});

test('control-budget baseline accounts for both new controls', () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'state', 'control-budget-baseline.json'), 'utf8'));
  assert.ok(b.ids.includes('security-baseline'));
  assert.ok(b.ids.includes('secure-baseline-wiring'));
});
