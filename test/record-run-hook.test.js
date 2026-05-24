const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { test } = require('node:test');

function withGateway(handler) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for Pushgateway request')), 2000);
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        clearTimeout(timer);
        res.statusCode = 202;
        res.end('ok');
        resolve({ server, req, body });
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => handler(server.address().port));
  });
}

function withGatewayRequests(count, handler) {
  return new Promise((resolve, reject) => {
    const requests = [];
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} Pushgateway requests`)), 3000);
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ req, body });
        res.statusCode = 202;
        res.end('ok');
        if (requests.length === count) {
          clearTimeout(timer);
          resolve({ server, requests });
        }
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => handler(server.address().port));
  });
}

function runHook(projectDir, input, env) {
  const hookPath = path.join(projectDir, '.claude', 'hooks', 'record-run.js');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookPath], {
      cwd: projectDir,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-run-hook-'));
  const hooksDir = path.join(dir, '.claude', 'hooks');
  const scriptsDir = path.join(dir, '.claude', 'scripts');
  const skillsDir = path.join(dir, '.claude', 'skills');
  const stateDir = path.join(dir, '.claude', 'state');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'hooks', 'record-run.js'),
    path.join(hooksDir, 'record-run.js')
  );
  for (const scriptName of ['telemetry-memory.js', 'replay-telemetry.js']) {
    const source = path.join(__dirname, '..', '.claude', 'scripts', scriptName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(scriptsDir, scriptName));
    }
  }
  fs.writeFileSync(path.join(stateDir, 'current-lane'), 'improve');
  fs.writeFileSync(path.join(stateDir, 'current-mode'), 'full');
  fs.writeFileSync(path.join(stateDir, 'current-iteration'), '3');
  fs.writeFileSync(path.join(stateDir, 'current-group'), 'group "A"');
  fs.writeFileSync(path.join(stateDir, 'current-story'), 'story\\one');
  for (const [name, description] of Object.entries({
    brd: 'Create a business requirements document.',
    spec: 'Write implementation stories and acceptance criteria.',
    brownfield: 'Map an existing codebase before refactoring.',
  })) {
    const skillDir = path.join(skillsDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  }
  return dir;
}

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
  assert.equal(gateway.req.url, `/pushgateway/metrics/job/claude_harness_memory/instance/${encodeURIComponent(path.basename(projectDir))}`);
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

test('record-run emits generic tool telemetry for non-Task PostToolUse events', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      session_id: 'tool-session',
      tool_response: { is_error: false },
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_tool_events_total\{[^}]*tool="Write"/);
  assert.match(gateway.body, /harness_tool_events_total\{[^}]*exit="ok"/);
  assert.match(gateway.body, /harness_tool_events_total\{[^}]*lane="improve"/);
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
  assert.equal(last.req.url, `/metrics/job/claude_harness_memory/instance/${encodeURIComponent(path.basename(projectDir))}`);
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

test('settings enable native Claude Code telemetry for the OTEL collector', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));

  assert.equal(settings.env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(settings.env.OTEL_METRICS_EXPORTER, 'otlp');
  assert.equal(settings.env.OTEL_EXPORTER_OTLP_PROTOCOL, 'grpc');
  assert.equal(settings.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://localhost:4317');
  assert.equal(settings.env.HARNESS_PUSHGATEWAY_URL, 'http://localhost:9091');

  const settingsText = JSON.stringify(settings);
  assert.match(settingsText, /UserPromptSubmit/);
  assert.match(settingsText, /record-run\.js/);
  assert.match(settingsText, /Write\|Edit\|MultiEdit/);
  assert.match(settingsText, /"matcher":"Bash"/);
});
