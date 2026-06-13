'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { greet } = require('../app.js');

test('greets by name', () => {
  assert.strictEqual(greet('Ada'), 'Hello, Ada!');
});
