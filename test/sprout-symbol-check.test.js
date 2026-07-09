'use strict';

// Gap G30: pure symbol-range overlap arithmetic for sprout-diff-gate.js —
// mechanically verifies sprouting-instead-of-editing's Iron Law ("touch the
// legacy file at exactly one call line, or the rename pair for wrap") by
// counting how many DISTINCT leaf symbols (methods when a class has them,
// the symbol itself otherwise — see the file header for why methods win
// over their enclosing class) a staged diff's changed line ranges overlap.

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { leafSymbols, symbolsTouchedByRanges } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'sprout-symbol-check')
);

test('leafSymbols: a top-level function with no children is its own leaf', () => {
  const record = { symbols: [{ name: 'f', start: 1, end: 5 }] };
  assert.deepStrictEqual(leafSymbols(record), [{ name: 'f', start: 1, end: 5 }]);
});

test('leafSymbols: a class with methods yields only the methods, qualified, not the class itself', () => {
  const record = {
    symbols: [{
      name: 'Widget', start: 1, end: 20,
      children: [{ name: 'a', start: 2, end: 5 }, { name: 'b', start: 6, end: 10 }],
    }],
  };
  assert.deepStrictEqual(leafSymbols(record), [
    { name: 'Widget.a', start: 2, end: 5 },
    { name: 'Widget.b', start: 6, end: 10 },
  ]);
});

test('leafSymbols: a method-less class is its own leaf (e.g. a dataclass)', () => {
  const record = { symbols: [{ name: 'Point', start: 1, end: 3 }] };
  assert.deepStrictEqual(leafSymbols(record), [{ name: 'Point', start: 1, end: 3 }]);
});

test('symbolsTouchedByRanges: a single changed range inside one symbol -> one touched symbol', () => {
  const record = { symbols: [{ name: 'f', start: 1, end: 5 }, { name: 'g', start: 20, end: 25 }] };
  assert.deepStrictEqual(symbolsTouchedByRanges(record, [[2, 2]]), ['f']);
});

test('symbolsTouchedByRanges: ranges in two different symbols -> both are touched', () => {
  const record = { symbols: [{ name: 'f', start: 1, end: 5 }, { name: 'g', start: 20, end: 25 }] };
  assert.deepStrictEqual(symbolsTouchedByRanges(record, [[2, 2], [21, 21]]), ['f', 'g']);
});

test('symbolsTouchedByRanges: a change inside a method touches only that method, not the class', () => {
  const record = {
    symbols: [{
      name: 'Widget', start: 1, end: 20,
      children: [{ name: 'a', start: 2, end: 5 }, { name: 'b', start: 6, end: 10 }],
    }],
  };
  assert.deepStrictEqual(symbolsTouchedByRanges(record, [[3, 3]]), ['Widget.a']);
});

test('symbolsTouchedByRanges: a change touching nothing (e.g. module-level import) returns an empty list', () => {
  const record = { symbols: [{ name: 'f', start: 10, end: 15 }] };
  assert.deepStrictEqual(symbolsTouchedByRanges(record, [[1, 1]]), []);
});

test('symbolsTouchedByRanges: result names are deduplicated and sorted', () => {
  const record = { symbols: [{ name: 'f', start: 1, end: 5 }] };
  assert.deepStrictEqual(symbolsTouchedByRanges(record, [[1, 2], [3, 4]]), ['f']);
});

test('symbolsTouchedByRanges: ranges === null (unknown) returns null, not an empty list', () => {
  const record = { symbols: [{ name: 'f', start: 1, end: 5 }] };
  assert.strictEqual(symbolsTouchedByRanges(record, null), null);
});

test('symbolsTouchedByRanges: a missing/empty symbols array never throws', () => {
  assert.deepStrictEqual(symbolsTouchedByRanges({}, [[1, 2]]), []);
  assert.deepStrictEqual(symbolsTouchedByRanges({ symbols: [] }, [[1, 2]]), []);
});
