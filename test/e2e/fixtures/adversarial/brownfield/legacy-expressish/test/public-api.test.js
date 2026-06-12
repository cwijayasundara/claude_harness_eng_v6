'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { handle } = require('../src/public-api');

test('health response keeps legacy version shape', () => {
  assert.deepStrictEqual(handle('GET', '/health'), {
    status: 200,
    body: { ok: true, version: '1' },
  });
});

test('ticket lookup keeps legacy envelope', () => {
  assert.deepStrictEqual(handle('GET', '/tickets/T-200'), {
    status: 200,
    body: {
      data: { id: 'T-200', title: 'VPN unavailable', priority: 'high' },
      meta: { apiVersion: '1' },
    },
  });
});

test('unknown routes keep NOT_FOUND contract', () => {
  assert.deepStrictEqual(handle('GET', '/missing'), {
    status: 404,
    body: { code: 'NOT_FOUND' },
  });
});
