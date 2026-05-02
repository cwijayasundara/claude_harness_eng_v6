'use strict';

const { loadConfig } = require('./config');
const { LinearTracker } = require('./tracker/linear');
const { JiraTracker } = require('./tracker/jira');
const { WorkspaceManager } = require('./orchestrator/workspace-manager');
const { ClaudeRunner } = require('./orchestrator/claude-runner');
const { Scheduler } = require('./orchestrator/scheduler');
const { StateStore } = require('./orchestrator/state-store');
const { createLogger } = require('./observability/logger');
const { startStatusServer } = require('./observability/status-server');

async function main() {
  const config = loadConfig();
  const tracker = createTracker(config);
  const workspaceManager = new WorkspaceManager(config);
  const claudeRunner = new ClaudeRunner(config);
  const stateStore = new StateStore({ stateDir: config.stateDir });
  const logger = createLogger(config);
  const scheduler = new Scheduler({ config, tracker, workspaceManager, claudeRunner, stateStore, logger });

  logger.info('orchestrator_started', { provider: config.provider, workspaceRoot: config.workspaceRoot });
  if (config.statusPort > 0) await startStatusServer({ port: config.statusPort, stateStore, logger });

  await runTick(scheduler);
  setInterval(() => {
    runTick(scheduler).catch((error) => {
      console.error('scheduler tick failed:', error);
    });
  }, config.pollIntervalMs);
}

function createTracker(config) {
  if (config.provider === 'linear') return new LinearTracker(config);
  if (config.provider === 'jira') return new JiraTracker(config);
  throw new Error(`Unsupported provider: ${config.provider}`);
}

async function runTick(scheduler) {
  const result = await scheduler.tick();
  scheduler.logger.info('tick_completed', result);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main, createTracker, runTick };
