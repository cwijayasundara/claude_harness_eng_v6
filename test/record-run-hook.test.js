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

test('record-run pushes escaped custom metrics to a configured Pushgateway path', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Task',
      session_id: 'session/one',
      tool_input: { subagent_type: 'test"agent' },
      tool_response: { is_error: false },
    }, {
      HARNESS_USER: 'dev "one"',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}/pushgateway`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  assert.equal(gateway.req.method, 'POST');
  assert.equal(gateway.req.url, `/pushgateway/metrics/job/claude_harness_memory/instance/${encodeURIComponent(stableProjectInstance(projectDir))}`);
  assert.match(gateway.body, /harness_agent_runs_total\{/);
  assert.match(gateway.body, /user="dev \\"one\\""/);
  assert.match(gateway.body, /agent="test\\"agent"/);
  assert.match(gateway.body, /group="group \\"A\\""/);
  assert.match(gateway.body, /story="story\\\\one"/);
  const ledgerPath = path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl');
  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'subagent');
  assert.equal(ledger[0].agent, 'test"agent');
});

test('record-run emits turns but not unknown agent runs for unnamed SubagentStop events', async () => {
  const projectDir = makeProject();
  const gateway = await withGatewayRequests(2, async (port) => {
    const env = {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    };
    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'session-two',
    };
    const first = await runHook(projectDir, input, env);
    assert.equal(first.status, 0, first.stderr);
    const second = await runHook(projectDir, input, env);
    assert.equal(second.status, 0, second.stderr);
  });

  gateway.server.close();

  const lastBody = gateway.requests[1].body;
  assert.doesNotMatch(lastBody, /harness_agent_runs_total\{/);
  assert.match(lastBody, /harness_conversation_turns_total\{[^}]*kind="subagent_stop"/);
  assert.match(lastBody, /lane="improve"/);
  assert.match(lastBody, /mode="full"/);
  assert.match(lastBody, /group="group \\"A\\""/);
  assert.match(lastBody, /harness_conversation_turns_total\{[^}]+\} 2/);
});

test('record-run emits prompt telemetry and updates lane for slash commands', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'prompt-session',
      prompt: '/brd create a LangChain search agent',
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_conversation_turns_total\{[^}]*kind="prompt"/);
  assert.match(gateway.body, /harness_conversation_turns_total\{[^}]*lane="brd"/);
  assert.match(gateway.body, /harness_command_invocations_total\{[^}]*command="brd"/);
  assert.match(gateway.body, /harness_skill_info\{[^}]*skill="brd"[^}]*path="\.claude\/skills\/brd\/SKILL\.md"/);
  assert.match(gateway.body, /harness_skill_info\{[^}]*skill="spec"[^}]*path="\.claude\/skills\/spec\/SKILL\.md"/);
  assert.match(gateway.body, /harness_skill_usage_total\{[^}]*skill="brd"[^}]*kind="prompt"[^}]*command="brd"/);
  assert.equal(
    fs.readFileSync(path.join(projectDir, '.claude', 'state', 'current-lane'), 'utf8').trim(),
    'brd'
  );
  const ledger = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(ledger[0].skill_names, ['brd']);
  assert.equal(ledger[0].skills[0].path, '.claude/skills/brd/SKILL.md');
  assert.equal(ledger[0].skill_inventory.length, 3);
});

test('record-run records normalized build lane variants, not just generic build', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'build-lane-session',
      prompt: '/build --auto --lite docs/prd.md',
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_conversation_turns_total\{[^}]*lane="lite-auto"/);
  assert.equal(
    fs.readFileSync(path.join(projectDir, '.claude', 'state', 'current-lane'), 'utf8').trim(),
    'lite-auto'
  );
});

test('record-run emits command telemetry for any non-scaffold slash command', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'brownfield-session',
      prompt: '/brownfield map the repo before refactor',
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_command_invocations_total\{[^}]*command="brownfield"/);
  assert.match(gateway.body, /harness_conversation_turns_total\{[^}]*lane="brownfield"/);
  assert.equal(
    fs.readFileSync(path.join(projectDir, '.claude', 'state', 'current-lane'), 'utf8').trim(),
    'brownfield'
  );
});

test('record-run skips command telemetry for scaffold', async () => {
  const projectDir = makeProject();
  const child = await runHook(projectDir, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'scaffold-session',
    prompt: '/scaffold',
  }, {
    HARNESS_USER: 'dev',
    HARNESS_PUSHGATEWAY_URL: 'http://127.0.0.1:1',
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.existsSync(path.join(projectDir, '.claude', 'runs')), true);
  const files = fs.readdirSync(path.join(projectDir, '.claude', 'runs'));
  assert.deepEqual(files, []);
  assert.equal(
    fs.readFileSync(path.join(projectDir, '.claude', 'state', 'current-lane'), 'utf8').trim(),
    'improve'
  );
});

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

test('telemetry is OFF by default — no OTEL/Pushgateway env vars, but record-run stays wired', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));

  // The harness's OWN repo stays telemetry-off — its dev/CI runs must not export
  // OTEL or push to a Pushgateway. (Scaffolded *projects* default telemetry ON;
  // that is injected into the copied settings and asserted in scaffold-apply.test.js.)
  assert.equal(settings.env.CLAUDE_CODE_ENABLE_TELEMETRY, undefined);
  assert.equal(settings.env.OTEL_METRICS_EXPORTER, undefined);
  assert.equal(settings.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
  assert.equal(settings.env.HARNESS_PUSHGATEWAY_URL, undefined);

  // The record-run hook is still wired (it just runs inert without a gateway URL).
  const settingsText = JSON.stringify(settings);
  assert.match(settingsText, /UserPromptSubmit/);
  assert.match(settingsText, /record-run\.js/);
  assert.match(settingsText, /Write\|Edit\|MultiEdit/);

  // record-run is back on the per-edit/per-Bash path, but receipt-append-only:
  // tool events never rebuild the ledger or push (see
  // record-run-tool-events.test.js) — the next prompt/Task/Stop push carries
  // them. PostToolUse(Task) keeps the full push: it carries subagent_type,
  // which the agent-runs and phase-eval metrics need, and Task completions
  // are rare.
  const perEditCommands = (settings.hooks.PostToolUse || [])
    .filter((m) => /Edit|Write|Bash/.test(m.matcher || ''))
    .flatMap((m) => (m.hooks || []).map((h) => h.command || ''));
  assert.ok(perEditCommands.some((c) => c.includes('record-run.js')));
});

test('record-run does not push metrics when no Pushgateway URL is configured', async () => {
  const projectDir = makeProject();
  // Run the hook with HARNESS_PUSHGATEWAY_URL explicitly unset.
  const env = { ...process.env };
  delete env.HARNESS_PUSHGATEWAY_URL;
  const result = await runHook(projectDir, {
    hook_event_name: 'Stop',
    session_id: 'no-telemetry',
  }, { HARNESS_PUSHGATEWAY_URL: '' });
  // It must exit cleanly (inert) without attempting a network push.
  assert.strictEqual(result.status, 0, result.stderr);
});
