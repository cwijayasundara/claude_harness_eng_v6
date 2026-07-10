'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { isStaleByName, planDeletes } = require('../.claude/scripts/runs-retention');

const NOW = new Date('2026-07-10T12:00:00.000Z');

test('isStaleByName: daily run ledger older than keepDays is stale', () => {
  assert.strictEqual(isStaleByName('2026-06-20.jsonl', NOW, 14), true);
  assert.strictEqual(isStaleByName('2026-07-05.jsonl', NOW, 14), false);
  assert.strictEqual(isStaleByName('2026-07-10.jsonl', NOW, 14), false);
});

test('isStaleByName: unknown names are kept', () => {
  assert.strictEqual(isStaleByName('notes.txt', NOW, 14), false);
  assert.strictEqual(isStaleByName('weird-file.jsonl', NOW, 14), false);
});

test('isStaleByName: ISO-stamped archive names', () => {
  assert.strictEqual(
    isStaleByName('telemetry-ledger-2026-06-01T10-00-00-000Z.jsonl', NOW, 30),
    true
  );
  assert.strictEqual(
    isStaleByName('telemetry-ledger-2026-07-07T10-43-36-434Z.jsonl', NOW, 30),
    false
  );
});

test('planDeletes with preferName uses filename dates', () => {
  const names = planDeletes(
    [
      { name: '2026-06-01.jsonl' },
      { name: '2026-07-09.jsonl' },
      { name: 'README.md' },
    ],
    { now: NOW, keepDays: 14, preferName: true }
  );
  assert.deepStrictEqual(names, ['2026-06-01.jsonl']);
});
