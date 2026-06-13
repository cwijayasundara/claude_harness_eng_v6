'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { sum, average } = require('./calc.js');

test('sum of an empty array is 0', () => {
  assert.strictEqual(sum([]), 0);
});

test('sum adds the numbers', () => {
  assert.strictEqual(sum([1, 2, 3]), 6);
});

test('average of an empty array is 0', () => {
  assert.strictEqual(average([]), 0);
});

test('average divides the sum by the count', () => {
  assert.strictEqual(average([2, 4, 6]), 4);
});
