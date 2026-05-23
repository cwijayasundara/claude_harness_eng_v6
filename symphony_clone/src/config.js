'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TERMINAL_STATES = ['Done', 'Closed', 'Canceled', 'Cancelled', 'Duplicate'];
const DEFAULT_MAX_WALLCLOCK_MS = 7200000;
const VALID_WORKSPACE_RETENTION = ['delete', 'keep'];

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function splitList(raw, fallback) {
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadEnvFile(env = process.env, envPath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(envPath)) return env;

  const updates = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(updates)) {
    if (!Object.prototype.hasOwnProperty.call(env, key) || env[key] === '') {
      env[key] = value;
    }
  }
  return env;
}

function parseEnvFile(raw) {
  const output = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) value = value.slice(0, commentIndex).trim();
    }

    output[key] = value.replace(/\\n/g, '\n');
  }

  return output;
}

function loadConfig(env = process.env, options = {}) {
  const shouldLoadDotEnv = Object.prototype.hasOwnProperty.call(options, 'loadDotEnv')
    ? options.loadDotEnv
    : env === process.env;
  if (shouldLoadDotEnv) loadEnvFile(env);
  const provider = env.TRACKER_PROVIDER || 'linear';
  const workspaceRoot = env.WORKSPACE_ROOT || '/workspaces';
  const repoUrl = env.TARGET_REPO_URL || '';
  const workspaceRetention = (env.WORKSPACE_RETENTION || 'delete').trim().toLowerCase();
  if (!VALID_WORKSPACE_RETENTION.includes(workspaceRetention)) {
    throw new Error(`WORKSPACE_RETENTION must be one of: ${VALID_WORKSPACE_RETENTION.join(', ')}`);
  }
  const maxWallclockMs = resolveMaxWallclockMs(env);

  const config = {
    provider,
    repoUrl,
    workspaceRoot,
    workspaceRetention,
    stateDir: env.STATE_DIR || path.join(workspaceRoot, '.symphony'),
    logRoot: env.LOG_ROOT || path.join(workspaceRoot, '.symphony', 'logs'),
    pollIntervalMs: intFromEnvWithEnv(env, 'POLL_INTERVAL_MS', 60000),
    maxConcurrentRuns: intFromEnvWithEnv(env, 'MAX_CONCURRENT_RUNS', 1),
    claudeCommand: env.CLAUDE_COMMAND || 'claude --print --permission-mode bypassPermissions',
    statusPort: intFromEnvWithEnv(env, 'STATUS_PORT', 0, { allowZero: true }),
    run: {
      maxWallclockMs
    },
    retry: {
      maxAttempts: intFromEnvWithEnv(env, 'MAX_RETRY_ATTEMPTS', 3),
      baseDelayMs: intFromEnvWithEnv(env, 'RETRY_BASE_DELAY_MS', 60000),
      maxDelayMs: intFromEnvWithEnv(env, 'RETRY_MAX_DELAY_MS', 900000)
    },
    github: {
      baseBranch: env.GITHUB_BASE_BRANCH || 'main',
      branchPrefix: env.BRANCH_PREFIX || 'agent',
      createPr: env.CREATE_PR !== 'false'
    },
    tracker: {
      readyState: env.READY_STATE || 'Ready for Agent',
      runningState: env.RUNNING_STATE || 'In Progress',
      reviewState: env.REVIEW_STATE || 'Human Review',
      blockedState: env.BLOCKED_STATE || 'Blocked',
      reviewStateCandidates: splitList(env.REVIEW_STATE_CANDIDATES, ['Human Review', 'In Review', 'Review']),
      blockedStateCandidates: splitList(env.BLOCKED_STATE_CANDIDATES, ['Blocked', 'Canceled', 'Cancelled']),
      readyLabel: env.READY_LABEL || 'agent-ready',
      terminalStates: splitList(env.TERMINAL_STATES, DEFAULT_TERMINAL_STATES)
    },
    linear: {
      apiKey: env.LINEAR_API_KEY || '',
      projectSlug: env.LINEAR_PROJECT_SLUG || '',
      apiUrl: env.LINEAR_API_URL || 'https://api.linear.app/graphql'
    },
    jira: {
      baseUrl: env.JIRA_BASE_URL || '',
      email: env.JIRA_EMAIL || '',
      apiToken: env.JIRA_API_TOKEN || '',
      projectKey: env.JIRA_PROJECT_KEY || ''
    }
  };

  validateConfig(config);
  return config;
}

function resolveMaxWallclockMs(env) {
  const candidates = ['MAX_WALLCLOCK_PER_RUN_MS', 'CLAUDE_TURN_TIMEOUT_MS'];
  for (const name of candidates) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  }
  return DEFAULT_MAX_WALLCLOCK_MS;
}

function intFromEnvWithEnv(env, name, fallback, options = {}) {
  const previous = process.env[name];
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    process.env[name] = env[name];
  }
  try {
    if (options.allowZero && process.env[name] === '0') return 0;
    return intFromEnv(name, fallback);
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function validateConfig(config) {
  if (!config.repoUrl) {
    throw new Error('TARGET_REPO_URL is required');
  }

  if (config.provider === 'linear') {
    if (!config.linear.apiKey) throw new Error('LINEAR_API_KEY is required for Linear');
    if (!config.linear.projectSlug) throw new Error('LINEAR_PROJECT_SLUG is required for Linear');
  } else if (config.provider === 'jira') {
    if (!config.jira.baseUrl) throw new Error('JIRA_BASE_URL is required for Jira');
    if (!config.jira.email) throw new Error('JIRA_EMAIL is required for Jira');
    if (!config.jira.apiToken) throw new Error('JIRA_API_TOKEN is required for Jira');
    if (!config.jira.projectKey) throw new Error('JIRA_PROJECT_KEY is required for Jira');
  } else {
    throw new Error(`Unsupported TRACKER_PROVIDER: ${config.provider}`);
  }
}

module.exports = {
  loadConfig,
  validateConfig,
  loadEnvFile,
  parseEnvFile,
  DEFAULT_TERMINAL_STATES,
  requiredEnv
};
