'use strict';

// Perf baseline: capture p50/p95/p99 per endpoint before a change; --compare
// fails on p95 regressions beyond the threshold. Tests run against an
// in-process HTTP server with a controllable delay.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'perf-baseline.js');
const { percentile, compareEndpoint } = require(script);

// IMPORTANT: async spawn, never spawnSync — the test server lives in THIS
// process, and spawnSync blocks the event loop, deadlocking the child CLI
// against a server that can no longer respond.
function runScript(args) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function withServer(delayMsRef, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      }, delayMsRef.value);
    });
    server.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        resolve(await fn(base));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('percentile picks the right rank', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.strictEqual(percentile(sorted, 50), 5);
  assert.strictEqual(percentile(sorted, 99), 10);
});

test('compareEndpoint flags regressions beyond the threshold only', () => {
  const before = { p50: 10, p95: 20, p99: 30 };
  assert.strictEqual(compareEndpoint('/x', before, { p50: 11, p95: 24, p99: 31 }, 50).verdict, 'OK');
  assert.strictEqual(compareEndpoint('/x', before, { p50: 40, p95: 90, p99: 99 }, 50).verdict, 'REGRESSION');
  assert.strictEqual(compareEndpoint('/x', undefined, { p50: 1, p95: 2, p99: 3 }, 50).verdict, 'NEW');
});

test('capture mode writes a baseline file with percentiles', async () => {
  await withServer({ value: 1 }, async (base) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
    const out = path.join(dir, 'perf-baseline.json');
    const res = await runScript(['--base', base, '--endpoints', '/health', '--samples', '5', '--out', out]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const baseline = JSON.parse(fs.readFileSync(out, 'utf8'));
    const stats = baseline.endpoints['/health'];
    assert.ok(stats.p50 > 0 && stats.p95 >= stats.p50 && stats.p99 >= stats.p95, JSON.stringify(stats));
  });
});

test('compare mode passes on similar latency and fails on a big regression', async () => {
  const delay = { value: 2 };
  await withServer(delay, async (base) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-cmp-'));
    const out = path.join(dir, 'perf-baseline.json');
    const capture = await runScript(['--base', base, '--endpoints', '/health', '--samples', '5', '--out', out]);
    assert.strictEqual(capture.status, 0, capture.stdout + capture.stderr);

    const same = await runScript(['--compare', '--base', base, '--endpoints', '/health', '--samples', '5', '--out', out, '--threshold', '400']);
    assert.strictEqual(same.status, 0, same.stdout + same.stderr);
    assert.ok(same.stdout.includes('OK: /health'), same.stdout);

    delay.value = 80; // massive regression
    const slow = await runScript(['--compare', '--base', base, '--endpoints', '/health', '--samples', '5', '--out', out, '--threshold', '100']);
    assert.strictEqual(slow.status, 1, slow.stdout + slow.stderr);
    assert.ok(slow.stdout.includes('REGRESSION: /health'), slow.stdout);
  });
});

test('errors clearly when the app is unreachable or baseline is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-err-'));
  const out = path.join(dir, 'perf-baseline.json');
  const unreachable = await runScript(['--base', 'http://127.0.0.1:1', '--endpoints', '/h', '--samples', '2', '--out', out]);
  assert.strictEqual(unreachable.status, 2, unreachable.stdout + unreachable.stderr);
  assert.ok(/unreachable/.test(unreachable.stderr), unreachable.stderr);
});

test('an absolute endpoint URL is used as-is, not concatenated onto base', async () => {
  await withServer({ value: 1 }, async (base) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-abs-'));
    const out = path.join(dir, 'perf-baseline.json');
    const res = await runScript(['--base', 'http://127.0.0.1:1', '--endpoints', `${base}/health`, '--samples', '3', '--out', out]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  });
});
