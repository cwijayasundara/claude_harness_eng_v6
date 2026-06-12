'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { appendEntry, loadLedger, parseLine } = require('../src/ledger');

test('parses legacy pipe-delimited entries', () => {
  assert.deepStrictEqual(parseLine('A-1|1250|legacy invoice'), {
    id: 'A-1',
    cents: 1250,
    note: 'legacy invoice',
  });
});

test('loads existing v1 ledger without migration', () => {
  const file = path.join(os.tmpdir(), `ledger-${Date.now()}.txt`);
  fs.writeFileSync(file, 'A-1|1250|legacy invoice\nB-2|500|refund\n');
  assert.deepStrictEqual(loadLedger(file), [
    { id: 'A-1', cents: 1250, note: 'legacy invoice' },
    { id: 'B-2', cents: 500, note: 'refund' },
  ]);
  fs.unlinkSync(file);
});

test('append preserves v1 storage format', () => {
  const file = path.join(os.tmpdir(), `ledger-${Date.now()}-append.txt`);
  appendEntry(file, { id: 'C-3', cents: 75, note: 'fee' });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'C-3|75|fee\n');
  fs.unlinkSync(file);
});
