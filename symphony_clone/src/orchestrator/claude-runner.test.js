'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runShellCommand } = require('./claude-runner');

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

test('timeout kills the whole process group, not just the wrapper shell', async () => {
  // The command spawns a grandchild (like `claude` under bash -lc) that
  // writes its PID then sleeps far past the timeout. If only the wrapper
  // shell is killed, the grandchild survives as an orphan burning tokens.
  const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runner-')), 'grandchild.pid');
  const command = `bash -c 'echo $$ > ${pidFile}; exec sleep 30' & wait`;

  await assert.rejects(
    () => runShellCommand(command, { cwd: os.tmpdir(), input: 'ignored', timeoutMs: 500 }),
    /timed out/
  );

  // Give the signal a moment to be delivered before checking.
  await new Promise((r) => setTimeout(r, 300));
  const grandchildPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.ok(grandchildPid > 0, 'grandchild never started');
  assert.equal(
    processAlive(grandchildPid), false,
    `grandchild ${grandchildPid} survived the timeout kill (orphaned process)`
  );
});
