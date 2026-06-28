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
      await runGit(this.runner, this.config.workspaceRoot, ['clone', this.config.repoUrl, workspacePath]);
    }

    await runGit(this.runner, workspacePath, ['fetch', 'origin', this.config.github.baseBranch]);

    const localBranchExists = !isFreshClone && await branchExists(this.runner, workspacePath, branchName);
    if (localBranchExists) {
      const commitsAhead = await countCommitsAhead(this.runner, workspacePath, branchName, baseRef);
      if (commitsAhead > 0) {
        const backupRef = buildRecoveryTag(branchName, runMeta);
        await runGit(this.runner, workspacePath, ['checkout', branchName]);
        await runGit(this.runner, workspacePath, ['tag', backupRef, branchName]);
        return { workspacePath, branchName, workspaceKey, resumed: true, commitsAhead, backupRef };
      }
    }

    await runGit(this.runner, workspacePath, ['checkout', '-B', branchName, baseRef]);
    return { workspacePath, branchName, workspaceKey, resumed: false };
  }

  async pushBranch(workspacePath, branchName) {
    await runGit(this.runner, workspacePath, ['push', '-u', 'origin', branchName, '--force-with-lease']);
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

// Env allowlist for git child processes. git config-exec vectors
// (core.sshCommand, filter.*.clean/smudge, core.fsmonitor) run with this env, so
// it must NOT carry orchestrator secrets (GITHUB_TOKEN, LINEAR_API_KEY, LLM keys).
// Keep only what git/ssh legitimately need. repoUrl is SSH, so no token is required.
const GIT_ENV_ALLOW = [
  /^PATH$/, /^HOME$/, /^USER$/, /^LOGNAME$/, /^SHELL$/, /^TERM$/,
  /^TMPDIR$/, /^TEMP$/, /^TMP$/,
  /^SSH_AUTH_SOCK$/, /^SSH_AGENT_PID$/,
  /^GIT_/, /^LANG$/, /^LANGUAGE$/, /^LC_/,
  /^https?_proxy$/i, /^all_proxy$/i, /^no_proxy$/i,
];

function scrubbedGitEnv(env = process.env) {
  const out = {};
  for (const key of Object.keys(env)) {
    if (GIT_ENV_ALLOW.some((re) => re.test(key))) out[key] = env[key];
  }
  return out;
}

function runGit(runner, cwd, args) {
  return runner('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: scrubbedGitEnv(process.env) });
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
    await runGit(runner, cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;                       // exit 0 -> exists
  } catch (error) {
    if (error && error.code === 1) return false;   // exit 1 -> genuinely absent
    throw error;                       // any other code -> real failure, propagate
  }
}

async function countCommitsAhead(runner, cwd, branch, base) {
  const { stdout } = await runGit(runner, cwd, ['rev-list', '--count', '--end-of-options', `${base}..${branch}`]);
  const n = Number.parseInt((stdout || '').trim(), 10);
  return Number.isFinite(n) ? n : 0;   // only a non-numeric stdout maps to 0; a thrown error propagates
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
  // - missing any alphanumeric -> '.' or '-' or empty
  // - trailing '.lock' (forbidden by git check-ref-format)
  if (!/[a-zA-Z0-9]/.test(cleaned) || cleaned.endsWith('.lock')) return 'group';
  return cleaned;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
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

module.exports = { WorkspaceManager, safeWorkspaceKey, runCommand, scrubbedGitEnv };
