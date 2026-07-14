'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { recordOutcome, readOutcomes, OUTCOMES_REL } = require('../.claude/hooks/lib/sensor-outcomes');

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'so-')); fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true }); return d; }

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
