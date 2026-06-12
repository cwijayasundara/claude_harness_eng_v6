'use strict';

const { spawn } = require('node:child_process');

class ClaudeRunner {
  constructor(config) {
    this.config = config;
  }

  async run(workspacePath, prompt) {
    return runShellCommand(this.config.claudeCommand, {
      cwd: workspacePath,
      input: prompt,
      timeoutMs: this.config.run && this.config.run.maxWallclockMs
        ? this.config.run.maxWallclockMs
        : Number(process.env.CLAUDE_TURN_TIMEOUT_MS || 3600000)
    });
  }
}

// detached: the child leads its own process group so the timeout kill can
// reach the whole tree — SIGTERM to bare bash does not propagate to the
// claude process it spawned, which would orphan it mid-run (still billing).
function spawnDetachedShell(commandWithPrompt, cwd) {
  const shell = process.env.SHELL || '/bin/bash';
  return spawn(shell, ['-lc', commandWithPrompt], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
}

function killProcessGroup(child) {
  try {
    process.kill(-child.pid, 'SIGTERM'); // whole process group
  } catch (_) {
    child.kill('SIGTERM'); // group already gone — best effort
  }
}

function wireStreams(child) {
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => {
    out.stdout += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    out.stderr += chunk.toString();
    process.stderr.write(chunk);
  });
  return out;
}

function runShellCommand(command, options) {
  return new Promise((resolve, reject) => {
    const commandWithPrompt = command.includes('{{prompt}}')
      ? command.replace('{{prompt}}', shellQuote(options.input))
      : `${command} ${shellQuote(options.input)}`;
    const child = spawnDetachedShell(commandWithPrompt, options.cwd);
    const out = wireStreams(child);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessGroup(child);
      reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout: out.stdout, stderr: out.stderr });
      else reject(new Error(`Command exited ${code}: ${out.stderr || out.stdout}`));
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

module.exports = { ClaudeRunner, runShellCommand, shellQuote };
