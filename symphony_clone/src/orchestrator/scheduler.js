'use strict';

const { buildHarnessPrompt, groupFromIssue } = require('./prompt-builder');
const { readResult, buildProofComment } = require('./result-reader');
const { runCommand } = require('./workspace-manager');

class Scheduler {
  constructor({ config, tracker, workspaceManager, claudeRunner, stateStore, logger }) {
    this.config = config;
    this.tracker = tracker;
    this.workspaceManager = workspaceManager;
    this.claudeRunner = claudeRunner;
    this.stateStore = stateStore;
    this.logger = logger || console;
    this.running = new Set();
  }

  async tick() {
    const candidates = await this.tracker.listCandidates();
    const reclaimed = await this.reclaimStuck(candidates);
    const eligible = candidates.filter((issue) => isEligible(issue, this.config));
    const retryReady = eligible.filter((issue) => !this.stateStore || this.stateStore.dueForRetry(issue));
    const capacity = Math.max(0, this.config.maxConcurrentRuns - this.running.size);

    for (const issue of retryReady.slice(0, capacity)) {
      this.runIssue(issue).catch((error) => {
        this.logger.error('run_unhandled_error', { issueKey: issue.key, error: error.message });
      });
    }

    return {
      candidates: candidates.length,
      reclaimed,
      eligible: eligible.length,
      retryReady: retryReady.length,
      started: Math.min(retryReady.length, capacity)
    };
  }

  async reclaimStuck(candidates) {
    const stuck = candidates.filter((issue) => isStuck(issue, this.running, this.config));
    let reclaimed = 0;

    for (const issue of stuck) {
      try {
        this.logger.warn('run_reclaim_started', { issueKey: issue.key, state: issue.state });

        if (this.stateStore) {
          this.stateStore.recordFailure(
            issue,
            new Error('Run abandoned (orchestrator restart or process crash)'),
            { ...this.config.retry, now: new Date() }
          );
        }

        await safeTrackerCall(
          this.tracker.addComment(
            issue.id,
            'Claude Harness orchestrator: previous run did not complete (orchestrator restart or process crash). Resetting to ready state for retry.'
          ),
          this.logger,
          issue
        );
        await this.tracker.moveIssue(issue.id, this.config.tracker.readyState);

        reclaimed++;
        this.logger.info('run_reclaimed', { issueKey: issue.key });
      } catch (error) {
        this.logger.error('run_reclaim_failed', { issueKey: issue.key, error: error.message });
      }
    }

    return reclaimed;
  }

  async runIssue(issue) {
    if (this.running.has(issue.id)) return;
    this.running.add(issue.id);

    try {
      const group = groupFromIssue(issue);
      const attempt = this.stateStore ? this.stateStore.nextAttempt(issue) : 1;
      if (this.stateStore) this.stateStore.startRun(issue, { attempt, groupId: group.id });
      this.logger.info('run_started', { issueKey: issue.key, groupId: group.id, attempt });
      await this.tracker.moveIssue(issue.id, this.config.tracker.runningState);
      await this.tracker.addComment(issue.id, `Claude Harness orchestrator claimed group ${group.id}.`);

      const workspace = await this.workspaceManager.prepare(issue, group, { attempt });
      if (workspace.resumed) {
        this.logger.info('workspace_resumed', {
          issueKey: issue.key,
          branchName: workspace.branchName,
          commitsAhead: workspace.commitsAhead,
          backupRef: workspace.backupRef
        });
      }
      if (this.stateStore) {
        const updatePayload = {
          workspacePath: workspace.workspacePath,
          branchName: workspace.branchName
        };
        if (workspace.resumed) updatePayload.recoveryTag = workspace.backupRef;
        this.stateStore.updateRun(issue, updatePayload);
      }
      const prompt = buildHarnessPrompt(issue, group);
      await this.claudeRunner.run(workspace.workspacePath, prompt);

      const runResult = await readResult(workspace.workspacePath, group.id);
      let prUrl = null;

      if (runResult.result.status === 'human_review') {
        await this.workspaceManager.pushBranch(workspace.workspacePath, workspace.branchName);
        prUrl = await maybeCreatePr(workspace.workspacePath, issue, group, this.config);
        await this.tracker.addComment(issue.id, buildProofComment(issue, group, runResult, prUrl));
        await this.tracker.moveIssue(issue.id, this.config.tracker.reviewState, this.config.tracker.reviewStateCandidates);
        if (this.stateStore) {
          this.stateStore.finishRun(issue, {
            status: 'human_review',
            branchName: workspace.branchName,
            workspacePath: workspace.workspacePath,
            prUrl
          });
        }
        this.logger.info('run_completed', { issueKey: issue.key, groupId: group.id, prUrl });
        await this.maybeCleanupWorkspace(issue, workspace.workspacePath);
      } else {
        await this.tracker.addComment(issue.id, buildProofComment(issue, group, runResult, prUrl));
        await this.tracker.moveIssue(issue.id, this.config.tracker.blockedState, this.config.tracker.blockedStateCandidates);
        if (this.stateStore) this.stateStore.finishRun(issue, { status: 'blocked' });
        this.logger.warn('run_blocked', { issueKey: issue.key, groupId: group.id });
        await this.maybeCleanupWorkspace(issue, workspace.workspacePath);
      }
    } catch (error) {
      await this.handleRunError(issue, error);
    } finally {
      this.running.delete(issue.id);
    }
  }

  async maybeCleanupWorkspace(issue, workspacePath) {
    if (!this.workspaceManager || typeof this.workspaceManager.cleanup !== 'function') return;
    try {
      await this.workspaceManager.cleanup(workspacePath);
    } catch (error) {
      this.logger.error('workspace_cleanup_failed', { issueKey: issue.key, workspacePath, error: error.message });
    }
  }

  async handleRunError(issue, error) {
    const run = this.stateStore
      ? this.stateStore.recordFailure(issue, error, { ...this.config.retry, now: new Date() })
      : { status: 'failed', attempt: 1 };
    this.logger.error('run_failed', { issueKey: issue.key, status: run.status, attempt: run.attempt, error: error.message });

    if (run.status === 'retry_wait') {
      await safeTrackerCall(
        this.tracker.addComment(issue.id, `Claude Harness orchestrator attempt ${run.attempt} failed: ${error.message}\n\nRetry scheduled for ${run.nextRetryAt}.`),
        this.logger,
        issue
      );
      return;
    }

    await safeTrackerCall(this.tracker.addComment(issue.id, `Claude Harness orchestrator blocked after ${run.attempt || 1} attempt(s): ${error.message}`), this.logger, issue);
    await safeTrackerCall(
      this.tracker.moveIssue(issue.id, this.config.tracker.blockedState, this.config.tracker.blockedStateCandidates),
      this.logger,
      issue
    );

    const workspacePath = run && run.workspacePath;
    if (workspacePath) {
      await this.maybeCleanupWorkspace(issue, workspacePath);
    }
  }
}

function isEligible(issue, config) {
  const stateMatches = normalize(issue.state) === normalize(config.tracker.readyState);
  const labels = issue.labels.map((label) => normalize(label));
  const labelMatches = labels.includes(normalize(config.tracker.readyLabel));
  const blockersDone = issue.blockedBy.every((blocker) =>
    config.tracker.terminalStates.map(normalize).includes(normalize(blocker.state))
  );
  return stateMatches && labelMatches && blockersDone;
}

function isStuck(issue, runningSet, config) {
  const inRunningState = normalize(issue.state) === normalize(config.tracker.runningState);
  const claimedByThisProcess = runningSet && runningSet.has(issue.id);
  return inRunningState && !claimedByThisProcess;
}

async function maybeCreatePr(workspacePath, issue, group, config) {
  if (!config.github.createPr) return null;

  try {
    const title = `Implement ${issue.key} group ${group.id}`;
    const body = `Automated Claude Harness run for ${issue.key}.\n\nGroup: ${group.id}\nStories: ${group.stories.join(', ') || 'not listed'}`;
    const { stdout } = await runCommand('gh', [
      'pr',
      'create',
      '--title',
      title,
      '--body',
      body,
      '--base',
      config.github.baseBranch
    ], { cwd: workspacePath });
    return stdout.trim().split('\n').pop();
  } catch (error) {
    return `PR creation skipped or failed: ${error.message}`;
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

async function safeTrackerCall(promise, logger, issue) {
  try {
    return await promise;
  } catch (error) {
    logger.error('tracker_update_failed', { issueKey: issue.key, error: error.message });
    return null;
  }
}

module.exports = { Scheduler, isEligible, isStuck, maybeCreatePr, safeTrackerCall };
