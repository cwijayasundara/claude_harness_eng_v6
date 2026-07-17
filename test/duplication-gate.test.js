'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { cloneKeys, gateDecision } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'duplication-gate.js')
);

// A minimal jscpd-report shape: { duplicates: [{ fragment, firstFile:{name}, secondFile:{name} }] }
const report = {
  duplicates: [
    { fragment: 'function parseAmount(x){ return x }', firstFile: { name: 'a.js' }, secondFile: { name: 'b.js' } },
  ],
};

test('cloneKeys yields one sorted occurrence key per participating file', () => {
  const keys = cloneKeys(report);
  assert.strictEqual(keys.length, 2);
  assert.ok(keys.every((k) => /^[0-9a-f]{8}:/.test(k)), 'each key is <hash8>:<file>');
  assert.ok(keys[0].endsWith(':a.js') && keys[1].endsWith(':b.js'));
  assert.deepStrictEqual(keys, [...keys].sort(), 'keys are sorted');
});

test('identical fragments in the same file collapse to one key', () => {
  const dup = { duplicates: [
    { fragment: 'X', firstFile: { name: 'a.js' }, secondFile: { name: 'a.js' } },
  ] };
  assert.strictEqual(cloneKeys(dup).length, 1);
});

test('whitespace-only differences hash to the same fragment', () => {
  const a = cloneKeys({ duplicates: [{ fragment: 'a  b\n c', firstFile: { name: 'f.js' }, secondFile: { name: 'g.js' } }] });
  const b = cloneKeys({ duplicates: [{ fragment: 'a b c',    firstFile: { name: 'f.js' }, secondFile: { name: 'g.js' } }] });
  assert.strictEqual(a[0].split(':')[0], b[0].split(':')[0], 'same fragment hash regardless of whitespace');
});

test('empty / missing duplicates yields no keys', () => {
  assert.deepStrictEqual(cloneKeys({}), []);
  assert.deepStrictEqual(cloneKeys({ duplicates: [] }), []);
});

test('gateDecision blocks when clone occurrences rise above baseline', () => {
  const d = gateDecision(['h:a.js', 'h:b.js', 'h:c.js'], 2);
  assert.strictEqual(d.count, 3);
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.newBaseline, 2, 'baseline must not move up on a block');
});

test('first run establishes the baseline without blocking (grandfathering)', () => {
  const d = gateDecision(['h:a.js', 'h:b.js'], undefined);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.baselineRun, true);
  assert.strictEqual(d.newBaseline, 2);
});
