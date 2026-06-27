'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

class WorkspaceManager {
  constructor(config, runner = runCommand) {
    this.config = config;
    this.runner = runner;
  }

  async prepare(issue, group, runMeta = {}) {
    const workspaceKey = safeWorkspaceKey(issue.key || group.id);
    const workspacePath = path.join(this.config.workspaceRoot, workspaceKey);
    const branchName = `${this.config.github.branchPrefix}/${workspaceKey}`;
    const baseRef = `origin/${this.config.github.baseBranch}`;

    await fs.mkdir(this.config.workspaceRoot, { recursive: true });

    const isFreshClone = !(await exists(path.join(workspacePath, '.git')));
    if (isFreshClone) {
      await this.runner('git', ['clone', this.config.repoUrl, workspacePath], { cwd: this.config.workspaceRoot });
    }

    await this.runner('git', ['fetch', 'origin', this.config.github.baseBranch], { cwd: workspacePath });

    const localBranchExists = !isFreshClone && await branchExists(this.runner, workspacePath, branchName);
    if (localBranchExists) {
      const commitsAhead = await countCommitsAhead(this.runner, workspacePath, branchName, baseRef);
      if (commitsAhead > 0) {
        const backupRef = buildRecoveryTag(branchName, runMeta);
        await this.runner('git', ['checkout', branchName], { cwd: workspacePath });
        await this.runner('git', ['tag', backupRef, branchName], { cwd: workspacePath });
        return { workspacePath, branchName, workspaceKey, resumed: true, commitsAhead, backupRef };
      }
    }

    await this.runner('git', ['checkout', '-B', branchName, baseRef], { cwd: workspacePath });
    return { workspacePath, branchName, workspaceKey, resumed: false };
  }

  async pushBranch(workspacePath, branchName) {
    await this.runner('git', ['push', '-u', 'origin', branchName, '--force-with-lease'], { cwd: workspacePath });
  }

  async cleanup(workspacePath) {
    if (this.config.workspaceRetention === 'keep') return;

    const root = path.resolve(this.config.workspaceRoot);
    const target = path.resolve(workspacePath);
    if (target === root || !target.startsWith(root + path.sep)) {
      throw new Error(`Refusing to delete ${target}: outside workspaceRoot ${root}`);
    }

    await fs.rm(target, { recursive: true, force: true });
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

async function branchExists(runner, cwd, branchName) {
  try {
    await runner('git', ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branchName}`], { cwd });
    return true;
  } catch (_) {
    return false;
  }
}

async function countCommitsAhead(runner, cwd, branch, base) {
  try {
    const { stdout } = await runner('git', ['rev-list', '--count', '--end-of-options', `${base}..${branch}`], { cwd });
    const n = Number.parseInt((stdout || '').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}

function buildRecoveryTag(branchName, runMeta) {
  const attempt = runMeta && runMeta.attempt != null ? runMeta.attempt : 'unknown';
  const suffix = randomUUID().slice(0, 8);
  return `recovery/${branchName}/attempt-${attempt}-${Date.now()}-${suffix}`;
}

function safeWorkspaceKey(value) {
  const cleaned = String(value || 'group')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  // Reject outputs that would produce malformed git refs:
  // - missing any alphanumeric → '.' or '-' or empty
  // - trailing '.lock' (forbidden by git check-ref-format)
  if (!/[a-zA-Z0-9]/.test(cleaned) || cleaned.endsWith('.lock')) return 'group';
  return cleaned;
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
        const error = new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr || stdout}`);
        error.code = code;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

module.exports = { WorkspaceManager, safeWorkspaceKey, runCommand };
