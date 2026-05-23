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

function runShellCommand(command, options) {
  return new Promise((resolve, reject) => {
    const commandWithPrompt = command.includes('{{prompt}}')
      ? command.replace('{{prompt}}', shellQuote(options.input))
      : `${command} ${shellQuote(options.input)}`;

    const shell = process.env.SHELL || '/bin/bash';
    const child = spawn(shell, ['-lc', commandWithPrompt], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
      }
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command exited ${code}: ${stderr || stdout}`));
      }
    });

  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

module.exports = { ClaudeRunner, runShellCommand, shellQuote };
