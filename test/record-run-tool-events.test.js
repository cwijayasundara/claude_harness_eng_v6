/**
 * Tool-event telemetry: generic (non-Task) PostToolUse events append a
 * receipt + ledger record but never push — the push happens on the next
 * prompt/Task/Stop event. Keeps harness_tool_events_total publishable
 * (Tool Activity dashboard panels) without the per-edit push cost that
 * got record-run descoped from the hot path in the hook consolidation.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { test } = require('node:test');
const { runHook, makeProject } = require('./helpers/record-run-fixture');

// Passive collector: counts every request so an unexpected tool-time push is
// detected (withGateway resolves on the first request and would mask it).
function startCollector() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push(body);
      res.statusCode = 202;
      res.end('ok');
    });
  });
  server.unref();
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests }));
  });
}

test('tool events append receipts without pushing; the next Stop push carries them', async () => {
  const projectDir = makeProject();
  const { server, requests } = await startCollector();
  const env = {
    HARNESS_USER: 'dev',
    HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${server.address().port}`,
  };

  const toolResult = await runHook(projectDir, {
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    session_id: 'tool-session',
    tool_response: { is_error: false },
  }, env);
  assert.equal(toolResult.status, 0, toolResult.stderr);
  assert.equal(requests.length, 0, 'tool events must stay off the push path');
  const ledger = fs.readFileSync(
    path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl'), 'utf8'
  ).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'tool');
  assert.equal(ledger[0].tool, 'Write');

  const stopResult = await runHook(projectDir, {
    hook_event_name: 'Stop',
    session_id: 'tool-session',
  }, env);
  server.close();
  assert.equal(stopResult.status, 0, stopResult.stderr);
  assert.equal(requests.length, 1, 'Stop must push exactly once');
  assert.match(requests[0], /harness_tool_events_total\{[^}]*tool="Write"/);
  assert.match(requests[0], /harness_tool_events_total\{[^}]*exit="ok"/);
  assert.match(requests[0], /harness_tool_events_total\{[^}]*lane="improve"/);
});

test('record-run is wired for mutating tools so harness_tool_events_total publishes', () => {
  const settings = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8')
  );
  const recordRunMatchers = (settings.hooks.PostToolUse || [])
    .filter((m) => (m.hooks || []).some((h) => (h.command || '').includes('record-run.js')))
    .map((m) => m.matcher);
  assert.ok(recordRunMatchers.includes('Task'), 'Task matcher must stay (subagent metrics)');
  assert.ok(
    recordRunMatchers.some((m) => /Bash/.test(m) && /Write/.test(m) && /Edit/.test(m)),
    'record-run must cover Write|Edit|MultiEdit|Bash for tool-event telemetry'
  );
});
