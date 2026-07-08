/**
 * Unit tests for telemetry-memory.js — focused on pushSnapshot HTTP behaviour.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const { test } = require('node:test');

const { pushSnapshot, buildSnapshot, stableProjectInstance } = require(
  path.join(__dirname, '..', '.claude', 'scripts', 'telemetry-memory')
);

test('stableProjectInstance disambiguates same-named projects on different paths', () => {
  const a = stableProjectInstance('/work/alice/app');
  const b = stableProjectInstance('/work/bob/app');
  assert.ok(a.startsWith('app-'), `instance must stay readable (got ${a})`);
  assert.notStrictEqual(a, b,
    'same basename on different paths must not share a pushgateway group');
  assert.strictEqual(a, stableProjectInstance('/work/alice/app'),
    'instance must be stable across calls');
});

// Spin up a minimal test Pushgateway that responds with a given status code.
function makeGateway(statusCode) {
  return new Promise((resolve, reject) => {
    let captured = { body: '' };
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        captured.body = body;
        captured.req = req;
        res.statusCode = statusCode;
        res.end('response');
      });
    });
    server.on('error', reject);
    server.unref();
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }));
  });
}

test('pushSnapshot resolves pushed:false (empty snapshot) when no ledger exists', async () => {
  const os = require('os');
  const fs = require('fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pushsnapshot-empty-'));
  const stateDir = path.join(tmpDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  // No ledger file → buildSnapshot returns empty string → pushed:false before HTTP.
  const { server, port } = await makeGateway(200);
  const result = await pushSnapshot({ projectDir: tmpDir, stateDir, gatewayUrl: `http://127.0.0.1:${port}` });
  server.close();
  assert.strictEqual(result.pushed, false,
    'empty snapshot must resolve pushed:false without making an HTTP call');
});

test('pushSnapshot resolves pushed:false when server returns 500', async () => {
  const { server, port } = await makeGateway(500);
  // Build a non-empty snapshot by pre-loading a record into a temp ledger.
  const os = require('os');
  const fs = require('fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pushsnapshot-'));
  const stateDir = path.join(tmpDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const record = {
    kind: 'turn', ts: Date.now(), user: 'test', lane: 'spec', mode: 'full',
    iteration: '1', group_id: 'A', story_id: 'E1-S1', host: 'host',
    agent: 'evaluator',
  };
  fs.writeFileSync(
    path.join(stateDir, 'telemetry-ledger.jsonl'),
    JSON.stringify(record) + '\n'
  );

  const result = await pushSnapshot({
    projectDir: tmpDir,
    stateDir,
    gatewayUrl: `http://127.0.0.1:${port}`,
  });
  server.close();

  assert.strictEqual(result.pushed, false,
    'a 500 response must resolve pushed:false, not pushed:true');
  assert.strictEqual(result.statusCode, 500);
});

test('pushSnapshot resolves pushed:true when server returns 202', async () => {
  const os = require('os');
  const fs = require('fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pushsnapshot-202-'));
  const stateDir = path.join(tmpDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const record = {
    kind: 'turn', ts: Date.now(), user: 'test', lane: 'spec', mode: 'full',
    iteration: '1', group_id: 'A', story_id: 'E1-S1', host: 'host',
    agent: 'evaluator',
  };
  fs.writeFileSync(
    path.join(stateDir, 'telemetry-ledger.jsonl'),
    JSON.stringify(record) + '\n'
  );

  const { server, port } = await makeGateway(202);
  const result = await pushSnapshot({
    projectDir: tmpDir,
    stateDir,
    gatewayUrl: `http://127.0.0.1:${port}`,
  });
  server.close();

  assert.strictEqual(result.pushed, true,
    'a 202 response must resolve pushed:true');
  assert.strictEqual(result.statusCode, 202);
});

test('pushSnapshot resolves pushed:false with disabled:true when no URL is configured', async () => {
  const saved = process.env.HARNESS_PUSHGATEWAY_URL;
  delete process.env.HARNESS_PUSHGATEWAY_URL;
  const result = await pushSnapshot({ projectDir: null, stateDir: null, gatewayUrl: undefined });
  if (saved !== undefined) process.env.HARNESS_PUSHGATEWAY_URL = saved;

  assert.strictEqual(result.pushed, false);
  assert.strictEqual(result.disabled, true);
});

test('buildSnapshot produces non-empty output for a turn record', () => {
  const record = {
    kind: 'turn', ts: Date.now(), user: 'dev', lane: 'spec', mode: 'full',
    iteration: '1', group_id: 'A', story_id: 'E1-S1', host: 'host',
    agent: 'evaluator',
  };
  const output = buildSnapshot([record]);
  assert.ok(output.includes('harness_conversation_turns_total'),
    'turn record must produce conversation_turns metric');
});
