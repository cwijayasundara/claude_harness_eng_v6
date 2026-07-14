const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { test } = require('node:test');
const {
  withGateway,
  withGatewayRequests,
  runHook,
  makeProject,
} = require('./helpers/record-run-fixture');
const { stableProjectInstance } = require(
  path.join(__dirname, '..', '.claude', 'scripts', 'telemetry-memory')
);

// Extracted from record-run-hook.test.js (SRP: replay-telemetry.js is a
// separate script from the record-run hook, exercised via the same fixture).

test('replay-telemetry rebuilds cumulative memory from the local ledger', async () => {
  const projectDir = makeProject();
  const gateway = await withGatewayRequests(3, async (port) => {
    const env = {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    };
    const input = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'prompt-session',
      prompt: '/spec write stories',
    };
    const first = await runHook(projectDir, input, env);
    assert.equal(first.status, 0, first.stderr);
    const second = await runHook(projectDir, input, env);
    assert.equal(second.status, 0, second.stderr);
    const replay = spawn(process.execPath, [path.join(projectDir, '.claude', 'scripts', 'replay-telemetry.js')], {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    replay.on('close', (status) => assert.equal(status, 0));
  });

  gateway.server.close();

  const last = gateway.requests[2];
  assert.equal(last.req.url, `/metrics/job/claude_harness_memory/instance/${encodeURIComponent(stableProjectInstance(projectDir))}`);
  assert.match(last.body, /harness_command_invocations_total\{[^}]*command="spec"[^}]*\} 2/);
  assert.match(last.body, /harness_conversation_turns_total\{[^}]*kind="prompt"[^}]*\} 2/);
  assert.match(last.body, /harness_skill_usage_total\{[^}]*skill="spec"[^}]*\} 2/);
});

test('replay-telemetry publishes installed skill inventory without prior events', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    const replay = spawn(process.execPath, [path.join(projectDir, '.claude', 'scripts', 'replay-telemetry.js')], {
      cwd: projectDir,
      env: {
        ...process.env,
        HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    replay.on('close', (status) => assert.equal(status, 0));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_skill_info\{[^}]*skill="brd"[^}]*path="\.claude\/skills\/brd\/SKILL\.md"/);
  assert.match(gateway.body, /harness_skill_info\{[^}]*skill="spec"[^}]*path="\.claude\/skills\/spec\/SKILL\.md"/);
  assert.match(gateway.body, /harness_skill_info\{[^}]*skill="brownfield"[^}]*path="\.claude\/skills\/brownfield\/SKILL\.md"/);
});

test('replay-telemetry seeds the ledger from existing run receipts', async () => {
  const projectDir = makeProject();
  const runsDir = path.join(projectDir, '.claude', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, '2026-05-24.jsonl'), JSON.stringify({
    kind: 'tool',
    ts: Date.now(),
    user: 'dev',
    lane: 'spec',
    mode: 'full',
    iteration: '0',
    group_id: 'none',
    story_id: 'none',
    tool: 'Write',
    exit: 'ok',
    host: 'host',
  }) + '\n');

  const gateway = await withGateway((port) => {
    const replay = spawn(process.execPath, [path.join(projectDir, '.claude', 'scripts', 'replay-telemetry.js')], {
      cwd: projectDir,
      env: {
        ...process.env,
        HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    replay.on('close', (status) => assert.equal(status, 0));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_tool_events_total\{[^}]*tool="Write"[^}]*\} 1/);
  assert.match(gateway.body, /harness_skill_usage_total\{[^}]*skill="spec"[^}]*source="lane"[^}]*\} 1/);
  assert.equal(fs.existsSync(path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl')), true);
});
