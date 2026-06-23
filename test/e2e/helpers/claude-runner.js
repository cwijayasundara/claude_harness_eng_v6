'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
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
  const { result, stdout, stderr } = spawnCapturedGroup('claude', args, {
    input: prompt, cwd, timeoutMs, env: buildClaudeEnv(),
  });
  return { stdout, stderr, exitCode: result.status, signal: result.signal, error: result.error };
}

function readTextOr(p, fallback) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return fallback; }
}

// spawnSync, but capture stdout/stderr to FILES instead of pipes and reap the
// whole process group afterward. With pipes, a grandchild that outlives the
// killed `claude` — a lingering dev server, or a node:test that never
// force-exits — keeps the pipe open, so spawnSync blocks draining it far past
// timeoutMs; because runClaude is synchronous that also wedges node:test's own
// timeout. Files never block, and the group-kill (-pid, only reachable because
// the child is detached/a group leader) cleans up the orphans spawnSync's
// single-pid SIGKILL leaves behind.
function spawnCapturedGroup(command, args, { input, cwd, timeoutMs, env }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-run-'));
  const outFd = fs.openSync(path.join(dir, 'out'), 'w');
  const errFd = fs.openSync(path.join(dir, 'err'), 'w');
  let result;
  try {
    result = spawnSync(command, args, {
      input, cwd, env, timeout: timeoutMs,
      killSignal: 'SIGKILL', detached: true, stdio: ['pipe', outFd, errFd],
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); } catch (_) { /* group already gone */ }
  }
  const stdout = readTextOr(path.join(dir, 'out'), '');
  const stderr = readTextOr(path.join(dir, 'err'), '');
  fs.rmSync(dir, { recursive: true, force: true });
  return { result, stdout, stderr };
}

module.exports = { runClaude, spawnCapturedGroup, HARNESS_ROOT };
