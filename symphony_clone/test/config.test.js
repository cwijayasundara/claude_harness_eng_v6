'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseEnvFile, loadEnvFile } = require('../src/config');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('loadConfig reads required Linear settings', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git',
    MAX_CONCURRENT_RUNS: '2',
    POLL_INTERVAL_MS: '5000',
    STATUS_PORT: '8787',
    MAX_RETRY_ATTEMPTS: '4',
    REVIEW_STATE_CANDIDATES: 'Human Review,In Review',
    BLOCKED_STATE_CANDIDATES: 'Blocked,Canceled'
  });

  assert.equal(config.provider, 'linear');
  assert.equal(config.linear.projectSlug, 'project');
  assert.equal(config.repoUrl, 'git@example.com:org/repo.git');
  assert.equal(config.maxConcurrentRuns, 2);
  assert.equal(config.pollIntervalMs, 5000);
  assert.equal(config.statusPort, 8787);
  assert.equal(config.retry.maxAttempts, 4);
  assert.deepEqual(config.tracker.reviewStateCandidates, ['Human Review', 'In Review']);
  assert.deepEqual(config.tracker.blockedStateCandidates, ['Blocked', 'Canceled']);
});

test('loadConfig rejects missing repo url', () => {
  assert.throws(() => loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project'
  }), /TARGET_REPO_URL/);
});

test('parseEnvFile supports comments, quotes, and export prefix', () => {
  const parsed = parseEnvFile(`
# comment
export TRACKER_PROVIDER=linear
LINEAR_PROJECT_SLUG="project slug"
READY_LABEL='agent-ready'
TARGET_REPO_URL=git@example.com:org/repo.git # inline comment
`);

  assert.equal(parsed.TRACKER_PROVIDER, 'linear');
  assert.equal(parsed.LINEAR_PROJECT_SLUG, 'project slug');
  assert.equal(parsed.READY_LABEL, 'agent-ready');
  assert.equal(parsed.TARGET_REPO_URL, 'git@example.com:org/repo.git');
});

test('loadConfig sets default maxWallclockMs to 2 hours', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git'
  });

  assert.equal(config.run.maxWallclockMs, 7200000);
});

test('loadConfig reads MAX_WALLCLOCK_PER_RUN_MS override', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git',
    MAX_WALLCLOCK_PER_RUN_MS: '1800000'
  });

  assert.equal(config.run.maxWallclockMs, 1800000);
});

test('loadConfig honours legacy CLAUDE_TURN_TIMEOUT_MS as alias', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git',
    CLAUDE_TURN_TIMEOUT_MS: '900000'
  });

  assert.equal(config.run.maxWallclockMs, 900000);
});

test('loadConfig MAX_WALLCLOCK_PER_RUN_MS wins over legacy alias', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git',
    MAX_WALLCLOCK_PER_RUN_MS: '1200000',
    CLAUDE_TURN_TIMEOUT_MS: '900000'
  });

  assert.equal(config.run.maxWallclockMs, 1200000);
});

test('loadConfig sets workspace retention default to delete', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git'
  });

  assert.equal(config.workspaceRetention, 'delete');
});

test('loadConfig rejects unknown WORKSPACE_RETENTION value', () => {
  assert.throws(() => loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git',
    WORKSPACE_RETENTION: 'maybe'
  }), /WORKSPACE_RETENTION/);
});

test('loadConfig accepts WORKSPACE_RETENTION=keep', () => {
  const config = loadConfig({
    TRACKER_PROVIDER: 'linear',
    LINEAR_API_KEY: 'lin_test',
    LINEAR_PROJECT_SLUG: 'project',
    TARGET_REPO_URL: 'git@example.com:org/repo.git',
    WORKSPACE_RETENTION: 'keep'
  });

  assert.equal(config.workspaceRetention, 'keep');
});

test('loadEnvFile fills missing values without overriding explicit env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-env-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, 'LINEAR_API_KEY=from_file\nTARGET_REPO_URL=from_file\n');

  const env = { TARGET_REPO_URL: 'from_shell' };
  loadEnvFile(env, envPath);

  assert.equal(env.LINEAR_API_KEY, 'from_file');
  assert.equal(env.TARGET_REPO_URL, 'from_shell');
});
