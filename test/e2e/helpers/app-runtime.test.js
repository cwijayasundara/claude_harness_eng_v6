'use strict';

const assert = require('assert');
const net = require('net');
const { test } = require('node:test');

const { waitForPort, stopApp, assertInBrowser, DEFAULT_PORT } = require('./app-runtime');

test('DEFAULT_PORT avoids the OTEL grpc port (4317)', () => {
  assert.notStrictEqual(DEFAULT_PORT, 4317);
  assert.ok(Number.isInteger(DEFAULT_PORT) && DEFAULT_PORT > 1024);
});

test('waitForPort resolves once a server is listening', async () => {
  const server = net.createServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  try {
    assert.strictEqual(await waitForPort(port, '127.0.0.1', 2000), true);
  } finally {
    server.close();
  }
});

test('waitForPort rejects when nothing ever listens', async () => {
  // Port 1 is privileged and never accepts a normal connection.
  await assert.rejects(() => waitForPort(1, '127.0.0.1', 600), /did not open/);
});

test('stopApp tolerates a null / already-dead handle', () => {
  assert.doesNotThrow(() => stopApp(null));
  assert.doesNotThrow(() => stopApp({ proc: { killed: true } }));
});

test('assertInBrowser surfaces a clear error when playwright is absent', async () => {
  // When the browser dep is not installed the helper must fail loudly with an
  // actionable message rather than a cryptic require error.
  let hadPlaywright = true;
  try { require.resolve('playwright'); } catch (_) { hadPlaywright = false; }
  if (hadPlaywright) return; // can't assert the absent-path when it's installed
  await assert.rejects(() => assertInBrowser('http://127.0.0.1:1', async () => {}), /playwright not installed/);
});
