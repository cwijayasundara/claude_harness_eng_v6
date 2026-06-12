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

  installSignalHandlers(scheduler, logger);
  const tick = makeSerializedTick(scheduler);
  await tick();
  setInterval(tick, config.pollIntervalMs);
}

function createTracker(config) {
  if (config.provider === 'linear') return new LinearTracker(config);
  if (config.provider === 'jira') return new JiraTracker(config);
  throw new Error(`Unsupported provider: ${config.provider}`);
}

// Serialize ticks: a slow tick (slow tracker API) must not overlap the next
// interval fire — overlapping ticks both read capacity before either claims
// it and can exceed MAX_CONCURRENT_RUNS.
function makeSerializedTick(scheduler) {
  let inFlight = false;
  return async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await runTick(scheduler);
    } catch (error) {
      scheduler.logger.error('scheduler_tick_failed', { error: error.message });
    } finally {
      inFlight = false;
    }
  };
}

// On docker stop, log which issues are still in flight before exiting so the
// next start's self-heal is explainable — without this, every clean restart
// silently abandons in-progress issues.
function installSignalHandlers(scheduler, logger) {
  const stop = (signal) => {
    const running = scheduler.running ? [...scheduler.running] : [];
    logger.info('orchestrator_stopping', { signal, in_flight: running });
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
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

module.exports = { main, createTracker, runTick, makeSerializedTick, installSignalHandlers };
