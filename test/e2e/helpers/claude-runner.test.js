'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { spawnCapturedGroup } = require('./claude-runner');

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
