const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
  // Full catalog must not be embedded per-record (REC-20260713-002); only a
  // lightweight count travels with each event. See replay-telemetry.test.js
  // for the round-trip proof that the full catalog is still recoverable.
  assert.equal(ledger[0].skill_inventory, undefined);
  assert.equal(ledger[0].skill_count, 3);
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

// REC-20260713-002: the full skill catalog was being embedded on every single
// ledger record (prompt/subagent/tool/turn/subagent_stop), which measured
// 95.8% of a record's bytes and was the root cause of the ledger bloat fixed
// separately by REC-20260713-003. This test round-trips the REAL hook +ledger
// +pushSnapshot pipeline (not a hand-built fixture) across all four producer
// call sites, and proves the downstream consumer still gets the full catalog.
test('record-run keeps every event kind free of the embedded skill catalog', async () => {
  const projectDir = makeProject();
  const gateway = await withGatewayRequests(2, async (port) => {
    const env = {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    };
    const promptResult = await runHook(projectDir, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'size-session',
      prompt: '/spec write stories',
    }, env);
    assert.equal(promptResult.status, 0, promptResult.stderr);

    const taskResult = await runHook(projectDir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Task',
      session_id: 'size-session',
      tool_input: { subagent_type: 'generator' },
      tool_response: { is_error: false },
    }, env);
    assert.equal(taskResult.status, 0, taskResult.stderr);
  });

  gateway.server.close();

  const ledgerPath = path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl');
  const records = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  for (const record of records) {
    assert.equal(record.skill_inventory, undefined, `${record.kind} record must not embed skill_inventory`);
    // A 3-skill fixture catalog should keep records well under 1KB; the
    // pre-fix bug produced ~8KB records for a ~100-skill real catalog.
    assert.ok(Buffer.byteLength(JSON.stringify(record)) < 1024, `${record.kind} record is unexpectedly large`);
  }

  // The real consumer (buildSnapshot via pushSnapshot) must still publish the
  // full installed-skill catalog — it re-reads from disk at push time instead
  // of depending on any per-record copy.
  const lastBody = gateway.requests[gateway.requests.length - 1].body;
  assert.match(lastBody, /harness_skill_info\{[^}]*skill="brd"[^}]*path="\.claude\/skills\/brd\/SKILL\.md"/);
  assert.match(lastBody, /harness_skill_info\{[^}]*skill="spec"[^}]*path="\.claude\/skills\/spec\/SKILL\.md"/);
  assert.match(lastBody, /harness_skill_info\{[^}]*skill="brownfield"[^}]*path="\.claude\/skills\/brownfield\/SKILL\.md"/);
});
