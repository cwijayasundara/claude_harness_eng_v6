'use strict';

const assert = require('assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { test } = require('node:test');

const { startApp, waitForPort, stopApp, assertInBrowser, DEFAULT_PORT } = require('./app-runtime');

function httpGetBody(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

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

test('startApp reaps a leaked stale server holding the fixed port (no false-negative)', async () => {
  // Regression: a server leaked by a prior attempt used to keep the fixed PORT,
  // and waitForPort happily reused it — so the browser saw STALE code. startApp
  // must reap the leak so the FRESH server owns the port.
  const PORT = 4519; // dedicated; freePort SIGKILLs whatever LISTENs here
  // Leaked "previous attempt" server in its OWN process (so freePort's SIGKILL
  // hits it, not this test runner), serving STALE content.
  const stale = spawn(process.execPath, ['-e',
    `require('http').createServer((q,s)=>s.end('STALE')).listen(${PORT},'127.0.0.1')`],
    { stdio: 'ignore' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-runtime-'));
  let app;
  try {
    await waitForPort(PORT, '127.0.0.1', 5000);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    fs.writeFileSync(path.join(dir, 'server.js'),
      "require('http').createServer((q,s)=>s.end('FRESH')).listen(process.env.PORT,'127.0.0.1');");

    app = await startApp(dir, { port: PORT, startTimeoutMs: 15000 });
    const body = await httpGetBody(app.baseUrl);
    assert.strictEqual(body, 'FRESH', 'fresh server must own the port after the leak is reaped');
  } finally {
    if (app) stopApp(app);
    try { stale.kill('SIGKILL'); } catch (_) { /* already reaped by freePort */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertInBrowser surfaces a clear error when playwright is absent', async () => {
  // When the browser dep is not installed the helper must fail loudly with an
  // actionable message rather than a cryptic require error.
  let hadPlaywright = true;
  try { require.resolve('playwright'); } catch (_) { hadPlaywright = false; }
  if (hadPlaywright) return; // can't assert the absent-path when it's installed
  await assert.rejects(() => assertInBrowser('http://127.0.0.1:1', async () => {}), /playwright not installed/);
});
