'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { recordOutcome, readOutcomes, OUTCOMES_REL } = require('../.claude/hooks/lib/sensor-outcomes');

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'so-')); fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true }); return d; }

// The ledger is what makes the control set subtractable, so the fields the value
// meter depends on — surface and cost — have to survive a round-trip.
test('recordOutcome persists surface, elapsed_ms and target', () => {
  const d = tmp();
  recordOutcome(d, { sensor: 'length-caps', ran: true, blocked: true, surface: 'session', elapsedMs: 12.6, target: 'src/a.js' });
  const [row] = readOutcomes(d);
  assert.strictEqual(row.surface, 'session');
  assert.strictEqual(row.elapsed_ms, 13, 'elapsed is rounded, not dropped');
  assert.strictEqual(row.target, 'src/a.js');
  assert.strictEqual(row.blocked, true);
});

test('recordOutcome omits optional fields rather than writing nulls', () => {
  const d = tmp();
  recordOutcome(d, { sensor: 'x', ran: true, blocked: false });
  const [row] = readOutcomes(d);
  assert.ok(!('surface' in row) && !('elapsed_ms' in row) && !('target' in row));
});

test('a logging failure never propagates to the caller', () => {
  // The ledger must not be able to break a gate: a sensor failing because its
  // telemetry failed would be strictly worse than having no telemetry.
  assert.doesNotThrow(() => recordOutcome('/nonexistent/path/that/cannot/be/made', { sensor: 'x', ran: true, blocked: false }));
});

test('recordOutcome appends a JSONL line readable by readOutcomes', () => {
  const d = tmp();
  recordOutcome(d, { sensor: 'layer-imports', ran: true, blocked: false });
  recordOutcome(d, { sensor: 'secret-scan', ran: true, blocked: true });
  const rows = readOutcomes(d);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].sensor, 'secret-scan');
  assert.strictEqual(rows[1].blocked, true);
  assert.strictEqual(typeof rows[1].ts, 'number');
});

test('recordOutcome never throws when the state dir is unwritable', () => {
  const d = tmp();
  // point at a path whose parent is a file → unwritable
  const bad = path.join(d, 'afile');
  fs.writeFileSync(bad, 'x');
  assert.doesNotThrow(() => recordOutcome(path.join(bad, 'nope'), { sensor: 's', ran: true, blocked: false }));
});

test('readOutcomes returns [] when ledger absent', () => {
  assert.deepStrictEqual(readOutcomes(tmp()), []);
});

// Step 7 (strengthened per controller override): verify the actual NEW behavior —
// fail() records a blocked:true outcome for the current sensor before exiting,
// and does so without ever letting a logging failure change control flow.
const { setFailContext, fail } = require('../.claude/hooks/lib/pre-commit-util');

test('fail() records a blocked outcome for the current sensor before exiting', () => {
  const d = tmp();
  setFailContext({ tier: 'standard', currentSensor: 'demo-gate', projectDir: d });
  const originalExit = process.exit;
  process.exit = () => { throw new Error('__exit__'); };
  try {
    assert.throws(() => fail('BLOCKED: x'), /__exit__/);
    const rows = readOutcomes(d);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].sensor, 'demo-gate');
    assert.strictEqual(rows[0].blocked, true);
  } finally {
    process.exit = originalExit;
    setFailContext({ tier: null, currentSensor: null, projectDir: null });
  }
});
