'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { analyzeBiting } = require('../.claude/hooks/lib/loop-health');

function seed(rows) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));
  fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true });
  if (rows) fs.writeFileSync(path.join(d, '.claude/state/sensor-outcomes.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return d;
}

test('under 5 commit runs it reports accruing history', () => {
  const d = seed([{ sensor: 'layer-imports', ran: true, blocked: false, ts: 1 }]);
  assert.strictEqual(analyzeBiting(d).accruing, true);
});

test('with >=5 runs it flags never-blocked gates', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) { rows.push({ sensor: 'layer-imports', ran: true, blocked: false, ts: i }); }
  rows.push({ sensor: 'secret-scan', ran: true, blocked: true, ts: 7 });
  const r = analyzeBiting(seed(rows));
  assert.strictEqual(r.accruing, false);
  assert.ok(r.neverBlocked.includes('layer-imports'));
  assert.ok(!r.neverBlocked.includes('secret-scan'));
});

test('never-fired lists commit gates absent from the ledger', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ sensor: 'secret-scan', ran: true, blocked: (i === 0), ts: i });
  const r = analyzeBiting(seed(rows));
  assert.ok(r.neverFired.includes('layer-imports')); // a real commit gate never seen
  assert.ok(!r.neverFired.includes('secret-scan'));
});
