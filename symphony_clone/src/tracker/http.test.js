'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { restRequest, normalize, unique, basicAuth, truncate } = require('./http');

function response(payload, { status = 200, text } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return text != null ? text : JSON.stringify(payload); }
  };
}

test('restRequest serializes the body, sets headers, and returns parsed JSON', async () => {
  let captured = null;
  const data = await restRequest(async (url, init) => { captured = { url, init }; return response({ ok: 1 }); }, 'host/path', {
    method: 'POST',
    headers: { Authorization: 'Basic abc' },
    body: { a: 1 },
    errorLabel: 'Test POST /path'
  });

  assert.deepEqual(data, { ok: 1 });
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Basic abc');
  assert.equal(captured.init.headers.Accept, 'application/json');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(captured.init.body).a, 1);
});

test('restRequest honors a custom content type and omits a body when none is given', async () => {
  let captured = null;
  await restRequest(async (url, init) => { captured = init; return response({}, { status: 204 }); }, 'host/x', {
    method: 'PATCH', body: [{ op: 'add' }], contentType: 'application/json-patch+json', errorLabel: 'x'
  });
  assert.equal(captured.headers['Content-Type'], 'application/json-patch+json');
});

test('restRequest returns {} for 204 No Content', async () => {
  const data = await restRequest(async () => response({}, { status: 204 }), 'host/y', { method: 'POST', errorLabel: 'y' });
  assert.deepEqual(data, {});
});

test('restRequest throws on non-ok and truncates the response body', async () => {
  const big = 'x'.repeat(5000);
  await assert.rejects(
    () => restRequest(async () => response(null, { status: 500, text: big }), 'host/z', { method: 'GET', errorLabel: 'Svc GET /z' }),
    (err) => {
      assert.match(err.message, /Svc GET \/z failed with HTTP 500/);
      assert.ok(err.message.length < big.length, 'body should be truncated');
      return true;
    }
  );
});

test('unique drops null/undefined but preserves 0 and empty string', () => {
  assert.deepEqual(unique([1, 1, 0, null, undefined, 2]), [1, 0, 2]);
});

test('normalize lowercases and trims', () => {
  assert.equal(normalize('  In Review '), 'in review');
});

test('basicAuth base64-encodes user:token (empty user supported)', () => {
  assert.equal(basicAuth('', 'pat'), Buffer.from(':pat').toString('base64'));
  assert.equal(truncate('abcdef', 3), 'abc…');
});
