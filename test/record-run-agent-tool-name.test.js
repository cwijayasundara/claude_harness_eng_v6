'use strict';

// The real subagent-dispatch tool's tool_name is "Agent" in this environment, and the
// real SubagentStop event's agent-name field is agent_type — both confirmed by direct
// hook-payload capture, both different from what record-run.js originally shipped
// against ("Task" / subagent_type|subagent|tool_input.subagent_type). Split out of
// record-run-hook.test.js to stay under its 300-line gate.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { withGateway, runHook, makeProject } = require('./helpers/record-run-fixture');

test('record-run treats a PostToolUse(Agent) event the same as PostToolUse(Task)', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      session_id: 'session/agent-name',
      tool_input: { subagent_type: 'code-reviewer' },
      tool_response: { is_error: false },
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}/pushgateway`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  assert.match(gateway.body, /harness_agent_runs_total\{/);
  const ledgerPath = path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl');
  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'subagent', 'must be tallied as a subagent dispatch, not a generic tool call');
  assert.equal(ledger[0].agent, 'code-reviewer');
});

test('record-run falls back to tool_input.agent_type if subagent_type is ever absent', async () => {
  // Defensive fallback only — tool_input.subagent_type is the confirmed-real field
  // (see the previous test); this covers the case where it's ever missing.
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      session_id: 'session/agent-type-fallback',
      tool_input: { agent_type: 'evaluator' },
      tool_response: { is_error: false },
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}/pushgateway`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  const ledgerPath = path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl');
  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(ledger[0].agent, 'evaluator');
});

test('record-run resolves the agent name from a real SubagentStop event (agent_type field)', async () => {
  const projectDir = makeProject();
  const gateway = await withGateway((port) => {
    runHook(projectDir, {
      hook_event_name: 'SubagentStop',
      session_id: 'session/agent-type-field',
      agent_type: 'generator',
    }, {
      HARNESS_USER: 'dev',
      HARNESS_PUSHGATEWAY_URL: `http://127.0.0.1:${port}/pushgateway`,
    }).then((result) => assert.equal(result.status, 0, result.stderr));
  });

  gateway.server.close();

  const ledgerPath = path.join(projectDir, '.claude', 'state', 'telemetry-ledger.jsonl');
  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'subagent_stop');
  assert.equal(ledger[0].agent, 'generator', 'must resolve the real agent_type field, not fall back to unknown');
});
