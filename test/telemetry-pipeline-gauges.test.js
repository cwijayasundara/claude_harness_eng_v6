'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { pipelineGaugeLines } = require('../.claude/scripts/telemetry-pipeline-gauges');
const { pushSnapshot } = require('../.claude/scripts/telemetry-memory');

function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-gauges-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

const WITH_DATA = {
  'features.json': JSON.stringify([
    { id: 'a', group: 'A', passes: true },
    { id: 'b', group: 'A', passes: false },
  ]),
  'claude-progress.txt': '=== Session 0 ===\ncoverage: 88%\nnext_action: go\n',
  '.claude/state/coverage-baseline.txt': '80\n',
};

// Spin up a throwaway pushgateway that captures the POST body.
function makeGateway() {
  return new Promise((resolve) => {
    const captured = { body: '' };
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => { captured.body = body; res.statusCode = 202; res.end('ok'); });
    });
    server.unref();
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }));
  });
}
const http = require('http');

test('pipelineGaugeLines emits features and coverage gauges from project state', () => {
  const out = pipelineGaugeLines(makeProject(WITH_DATA));
  assert.match(out, /^harness_features_passing 1$/m);
  assert.match(out, /^harness_features_total 2$/m);
  assert.match(out, /^harness_coverage 88$/m);
  assert.match(out, /^harness_coverage_baseline 80$/m);
});

test('pipelineGaugeLines emits nothing for a fresh project (keeps empty pushes empty)', () => {
  assert.strictEqual(pipelineGaugeLines(makeProject()), '');
});

test('pushSnapshot includes the pipeline gauges in its push body', async () => {
  const dir = makeProject(WITH_DATA);
  const stateDir = path.join(dir, '.claude', 'state');
  // Give the ledger one record so there is a non-empty base snapshot to push.
  fs.writeFileSync(
    path.join(stateDir, 'telemetry-ledger.jsonl'),
    JSON.stringify({ kind: 'turn', ts: 1, user: 'u', host: 'h', lane: 'auto' }) + '\n'
  );
  const { server, captured, port } = await makeGateway();
  const result = await pushSnapshot({ projectDir: dir, stateDir, gatewayUrl: `http://127.0.0.1:${port}` });
  server.close();
  assert.strictEqual(result.pushed, true);
  assert.match(captured.body, /harness_features_passing 1/);
  assert.match(captured.body, /harness_coverage 88/);
});
