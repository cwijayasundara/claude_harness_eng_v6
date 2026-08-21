'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { spawnCapturedGroup, buildClaudeArgs } = require('./claude-runner');

// Regression: a grandchild that outlives the spawned command and keeps the
// stdout pipe open used to block spawnSync (pipe drain) far past the timeout,
// wedging the synchronous caller — the real smoke hung ~107 min this way.
// spawnCapturedGroup must return as soon as the DIRECT child exits, regardless
// of a lingering grandchild, and reap the group so the orphan does not survive.
test('spawnCapturedGroup returns promptly despite a grandchild holding stdout', () => {
  // node parent that spawns a detached grandchild inheriting stdout, the
  // grandchild sleeps 20s (holding the pipe), then the PARENT exits immediately.
  const parentScript =
    "const { spawn } = require('child_process');" +
    "spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: ['ignore', 1, 1], detached: true }).unref();" +
    "process.exit(0);";

  const started = Date.now();
  const { result } = spawnCapturedGroup(process.execPath, ['-e', parentScript], {
    input: '', cwd: process.cwd(), timeoutMs: 30000, env: process.env,
  });
  const elapsedMs = Date.now() - started;

  assert.strictEqual(result.status, 0, 'the direct child exits cleanly');
  // Without the fix this blocks ~20s (grandchild holds the pipe). With it, it
  // returns the instant the parent exits. Generous margin to avoid flakiness.
  assert.ok(elapsedMs < 8000, `must not block on the grandchild's pipe (took ${elapsedMs}ms)`);
});

test('spawnCapturedGroup captures stdout/stderr from files', () => {
  const script = "process.stdout.write('OUT'); process.stderr.write('ERR');";
  const { result, stdout, stderr } = spawnCapturedGroup(process.execPath, ['-e', script], {
    input: '', cwd: process.cwd(), timeoutMs: 10000, env: process.env,
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(stdout, 'OUT');
  assert.strictEqual(stderr, 'ERR');
});

// ── argv shape ─────────────────────────────────────────────────────────────
// A live route has no human, so anything that can stall waiting for one is a
// hang, not a failure. These pin the flags that keep a run unattended.

function argsFor(overrides = {}) {
  const o = {
    model: 'sonnet', budgetUsd: '1.00', continueSession: false, pluginDir: null,
    sessionId: null, outputFormat: null, permissionMode: 'auto', ...overrides,
  };
  return buildClaudeArgs(o.model, o.budgetUsd, o.continueSession, o.pluginDir,
    o.sessionId, o.outputFormat, o.permissionMode);
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

test('runs unattended: print mode, auto permissions, no inherited MCP servers', () => {
  const args = argsFor();
  assert.ok(args.includes('-p'), 'print mode — never an interactive REPL');
  assert.strictEqual(flagValue(args, '--permission-mode'), 'auto',
    'a permission prompt with no human to answer it is a hang');
  assert.ok(args.includes('--strict-mcp-config'), 'must not inherit the developer global MCP servers');
  assert.strictEqual(flagValue(args, '--max-budget-usd'), '1.00', 'every run is budget-capped');
});

test('permission mode is overridable but never silently absent', () => {
  assert.strictEqual(flagValue(argsFor({ permissionMode: 'default' }), '--permission-mode'), 'default');
});

test('a fresh session id is set, and a continued one is resumed', () => {
  const fresh = argsFor({ sessionId: 'abc', continueSession: false });
  assert.strictEqual(flagValue(fresh, '--session-id'), 'abc');
  assert.ok(!fresh.includes('--resume'), 'a new phase must not resume');

  // This is the seam the approval turns use: answer the SAME session.
  const resumed = argsFor({ sessionId: 'abc', continueSession: true });
  assert.strictEqual(flagValue(resumed, '--resume'), 'abc');
  assert.ok(!resumed.includes('--session-id'), 'resume and session-id are mutually exclusive');
});
