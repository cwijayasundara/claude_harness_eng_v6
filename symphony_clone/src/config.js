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
  maybeLoadDotEnv(env, options);
  const workspaceRoot = env.WORKSPACE_ROOT || '/workspaces';
  const config = {
    provider: normalizeProvider(env.TRACKER_PROVIDER),
    repoUrl: env.TARGET_REPO_URL || '',
    workspaceRoot,
    workspaceRetention: resolveRetention(env),
    stateDir: env.STATE_DIR || path.join(workspaceRoot, '.symphony'),
    logRoot: env.LOG_ROOT || path.join(workspaceRoot, '.symphony', 'logs'),
    pollIntervalMs: intFromEnvWithEnv(env, 'POLL_INTERVAL_MS', 60000),
    maxConcurrentRuns: intFromEnvWithEnv(env, 'MAX_CONCURRENT_RUNS', 1),
    claudeCommand: env.CLAUDE_COMMAND || 'claude --print --permission-mode bypassPermissions',
    statusPort: intFromEnvWithEnv(env, 'STATUS_PORT', 0, { allowZero: true }),
    run: { maxWallclockMs: resolveMaxWallclockMs(env) },
    retry: buildRetry(env),
    github: buildGithub(env),
    autoMerge: buildAutoMerge(env),
    tracker: buildTracker(env),
    linear: buildLinear(env),
    jira: buildJira(env),
    azure: buildAzure(env)
  };
  validateConfig(config);
  return config;
}

// Accept friendly aliases for Azure DevOps so TRACKER_PROVIDER is forgiving.
function normalizeProvider(raw) {
  const provider = (raw || 'linear').trim().toLowerCase();
  if (['ado', 'azuredevops', 'azure-devops', 'azure_devops'].includes(provider)) return 'azure';
  return provider;
}

function maybeLoadDotEnv(env, options) {
  const shouldLoad = Object.prototype.hasOwnProperty.call(options, 'loadDotEnv') ? options.loadDotEnv : env === process.env;
  if (shouldLoad) loadEnvFile(env);
}

function resolveRetention(env) {
  const retention = (env.WORKSPACE_RETENTION || 'delete').trim().toLowerCase();
  if (!VALID_WORKSPACE_RETENTION.includes(retention)) {
    throw new Error(`WORKSPACE_RETENTION must be one of: ${VALID_WORKSPACE_RETENTION.join(', ')}`);
  }
  return retention;
}

function buildRetry(env) {
  return {
    maxAttempts: intFromEnvWithEnv(env, 'MAX_RETRY_ATTEMPTS', 3),
    baseDelayMs: intFromEnvWithEnv(env, 'RETRY_BASE_DELAY_MS', 60000),
    maxDelayMs: intFromEnvWithEnv(env, 'RETRY_MAX_DELAY_MS', 900000)
  };
}

function buildGithub(env) {
  return {
    baseBranch: env.GITHUB_BASE_BRANCH || 'main',
    branchPrefix: env.BRANCH_PREFIX || 'agent',
    createPr: env.CREATE_PR !== 'false'
  };
}

const VALID_MERGE_METHODS = ['merge', 'squash', 'rebase'];
function normalizeMergeMethod(raw) {
  const method = (raw || 'merge').trim().toLowerCase();
  if (!VALID_MERGE_METHODS.includes(method)) {
    throw new Error(`MERGE_METHOD must be one of: ${VALID_MERGE_METHODS.join(', ')}`);
  }
  return method;
}

function buildAutoMerge(env) {
  return {
    enabled: env.AUTO_MERGE === 'true',
    method: normalizeMergeMethod(env.MERGE_METHOD),
    doneState: env.DONE_STATE || 'Done',
    doneStateCandidates: splitList(env.DONE_STATE_CANDIDATES, ['Done', 'Merged', 'Closed'])
  };
}

function buildTracker(env) {
  return {
    readyState: env.READY_STATE || 'Ready for Agent',
    runningState: env.RUNNING_STATE || 'In Progress',
    reviewState: env.REVIEW_STATE || 'Human Review',
    blockedState: env.BLOCKED_STATE || 'Blocked',
    reviewStateCandidates: splitList(env.REVIEW_STATE_CANDIDATES, ['Human Review', 'In Review', 'Review']),
    blockedStateCandidates: splitList(env.BLOCKED_STATE_CANDIDATES, ['Blocked', 'Canceled', 'Cancelled']),
    readyLabel: env.READY_LABEL || 'agent-ready',
    planLabel: env.PLAN_LABEL || 'agent-plan',
    featureLabel: env.FEATURE_LABEL || 'agent-feature',
    plannedState: env.PLANNED_STATE || 'Planned',
    plannedStateCandidates: splitList(env.PLANNED_STATE_CANDIDATES, ['Planned', 'Ready for Agent']),
    terminalStates: splitList(env.TERMINAL_STATES, DEFAULT_TERMINAL_STATES)
  };
}

function buildLinear(env) {
  return {
    apiKey: env.LINEAR_API_KEY || '',
    projectSlug: env.LINEAR_PROJECT_SLUG || '',
    apiUrl: env.LINEAR_API_URL || 'https://api.linear.app/graphql'
  };
}

function buildJira(env) {
  return {
    baseUrl: (env.JIRA_BASE_URL || '').replace(/\/+$/, ''),
    email: env.JIRA_EMAIL || '',
    apiToken: env.JIRA_API_TOKEN || '',
    projectKey: env.JIRA_PROJECT_KEY || ''
  };
}

function buildAzure(env) {
  const orgUrl = (env.AZURE_DEVOPS_ORG_URL || '').replace(/\/+$/, '');
  const project = env.AZURE_DEVOPS_PROJECT || '';
  return {
    orgUrl,
    project,
    pat: env.AZURE_DEVOPS_PAT || '',
    baseUrl: orgUrl && project ? `${orgUrl}/${encodeURIComponent(project)}` : ''
  };
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
  } else if (config.provider === 'azure') {
    if (!config.azure.orgUrl) throw new Error('AZURE_DEVOPS_ORG_URL is required for Azure DevOps');
    if (!config.azure.project) throw new Error('AZURE_DEVOPS_PROJECT is required for Azure DevOps');
    if (!config.azure.pat) throw new Error('AZURE_DEVOPS_PAT is required for Azure DevOps');
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
