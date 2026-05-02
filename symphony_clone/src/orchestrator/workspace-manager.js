'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

class WorkspaceManager {
  constructor(config, runner = runCommand) {
    this.config = config;
    this.runner = runner;
  }

  async prepare(issue, group) {
    const workspaceKey = safeWorkspaceKey(issue.key || group.id);
    const workspacePath = path.join(this.config.workspaceRoot, workspaceKey);
    const branchName = `${this.config.github.branchPrefix}/${workspaceKey}`;

    await fs.mkdir(this.config.workspaceRoot, { recursive: true });

    if (!(await exists(path.join(workspacePath, '.git')))) {
      await this.runner('git', ['clone', this.config.repoUrl, workspacePath], { cwd: this.config.workspaceRoot });
    }

    await this.runner('git', ['fetch', 'origin', this.config.github.baseBranch], { cwd: workspacePath });
    await this.runner('git', ['checkout', '-B', branchName, `origin/${this.config.github.baseBranch}`], { cwd: workspacePath });

    return {
      workspacePath,
      branchName,
      workspaceKey
    };
  }

  async pushBranch(workspacePath, branchName) {
    await this.runner('git', ['push', '-u', 'origin', branchName, '--force-with-lease'], { cwd: workspacePath });
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function safeWorkspaceKey(value) {
  return String(value || 'group')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr || stdout}`));
      }
    });
  });
}

module.exports = { WorkspaceManager, safeWorkspaceKey, runCommand };
