'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HARNESS_ROOT = path.join(__dirname, '..', '..');
const E2E_SETTINGS = path.join(__dirname, '..', 'fixtures', 'e2e-settings.json');

function buildClaudeArgs(model, budgetUsd, continueSession, pluginDir, sessionId, outputFormat) {
  const args = [
    '-p',
    '--model', model,
    '--max-budget-usd', budgetUsd,
    '--settings', E2E_SETTINGS,
    '--exclude-dynamic-system-prompt-sections',
    // Isolate from the host's global MCP config. Without this, the nested
    // `claude` inherits the developer's global MCP servers (playwright-mcp,
    // aws-serverless-mcp, context7-mcp, …) and can hang for an hour on their
    // startup — and because those grandchildren hold the stdio pipes open,
    // spawnSync's timeout cannot reap the tree. No --mcp-config => zero MCP servers.
    '--strict-mcp-config',
  ];
  // Explicit session ids beat --continue: --continue grabs the most recent
  // session for the cwd, which can be a stale one from an earlier run.
  if (sessionId && continueSession) args.push('--resume', sessionId);
  else if (sessionId) args.push('--session-id', sessionId);
  else if (continueSession) args.push('--continue');
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  // stream-json exposes intermediate assistant turns (print mode requires --verbose with it)
  if (outputFormat) args.push('--output-format', outputFormat, '--verbose');
  return args;
}

function buildClaudeEnv() {
  return {
    ...process.env,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
    OTEL_METRIC_EXPORT_INTERVAL: '10000',
    // Push harness_* receipts live via the record-run hook, same path as
    // production. When the pushgateway is down the hook's push fails silently,
    // so this is safe to set unconditionally. Lets the build+observability e2e
    // prove real build activity reaches the dashboard (Part B of the
    // pipeline-progress proposal).
    HARNESS_PUSHGATEWAY_URL: process.env.HARNESS_PUSHGATEWAY_URL || 'http://localhost:9091',
  };
}

function runClaude(prompt, options = {}) {
  const {
    cwd = process.cwd(),
    model = 'sonnet',
    budgetUsd = '1.00',
    timeoutMs = 300000,
    continueSession = false,
    pluginDir = null,
    sessionId = null,
    outputFormat = null,
  } = options;

  const args = buildClaudeArgs(model, budgetUsd, continueSession, pluginDir, sessionId, outputFormat);
  const result = spawnSync('claude', args, {
    input: prompt,
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL', // SIGTERM can be survived mid-subprocess, hanging spawnSync past the cap
    env: buildClaudeEnv(),
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
  };
}

module.exports = { runClaude, HARNESS_ROOT };
