'use strict';

const { buildHarnessPrompt, groupFromIssue, buildFeaturePrompt } = require('./prompt-builder');
const { buildPlanningPrompt } = require('./planning-prompt');
const { readResult } = require('./result-reader');
const { enableAutoMerge } = require('./pr');
const { issueKind, isEligible, isStuck } = require('./eligibility');
const { finishExecution, finishPlanning } = require('./outcomes');

class Scheduler {
  constructor({ config, tracker, workspaceManager, claudeRunner, stateStore, logger, enableAutoMerge: enableAutoMergeFn }) {
    this.config = config;
    this.tracker = tracker;
    this.workspaceManager = workspaceManager;
    this.claudeRunner = claudeRunner;
    this.stateStore = stateStore;
    this.logger = logger || console;
    // Injectable so tests exercise the state machine without invoking real `gh`.
    this.enableAutoMerge = enableAutoMergeFn || enableAutoMerge;
    this.running = new Set();
  }

  async tick() {
    const candidates = await this.tracker.listCandidates();
    const reclaimed = await this.reclaimStuck(candidates);
    const eligible = candidates.filter((issue) => isEligible(issue, this.config));
    const retryReady = eligible.filter((issue) => !this.stateStore || this.stateStore.dueForRetry(issue));
    const capacity = Math.max(0, this.config.maxConcurrentRuns - this.running.size);

    for (const issue of retryReady.slice(0, capacity)) {
      this.dispatchIssue(issue).catch((error) => {
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
          this.tracker.addComment(issue.id, 'Claude Harness orchestrator: previous run did not complete (orchestrator restart or process crash). Resetting to ready state for retry.'),
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

  // Route by issue kind: a PRD (plan label) runs the architect planning pipeline;
  // a brownfield change (feature label) runs /feature --auto; a groomed group
  // (ready label) runs execution. Same claim/workspace/run spine.
  dispatchIssue(issue) {
    const kind = issueKind(issue, this.config);
    if (kind === 'plan') return this.runPlanningIssue(issue);
    if (kind === 'feature') return this.runFeatureIssue(issue);
    return this.runIssue(issue);
  }

  runIssue(issue) {
    const group = groupFromIssue(issue);
    return this.claimAndRun(issue, {
      group,
      startedEvent: 'run_started',
      claimedComment: `Claude Harness orchestrator claimed group ${group.id}.`,
      buildPrompt: (iss, grp) => buildHarnessPrompt(iss, grp),
      finish: (iss, grp, ws, rr) => finishExecution(this, iss, grp, ws, rr)
    });
  }

  // Architect stage: PRD -> /brd -> /spec -> /design -> /test -> /tracker-publish,
  // which publishes the per-cluster group issues the execution path then claims.
  runPlanningIssue(issue) {
    return this.claimAndRun(issue, {
      group: { id: issue.key, stories: [] },
      startedEvent: 'plan_started',
      claimedComment: 'Claude Harness orchestrator claimed PRD for planning.',
      buildPrompt: (iss) => buildPlanningPrompt(iss),
      finish: (iss, grp, ws, rr) => finishPlanning(this, iss, grp, ws, rr)
    });
  }

  // Brownfield stage: a raw change ticket -> /feature "<title>" --auto. One issue,
  // one symphony-opened PR; no PRD, no grooming, no group parsing.
  runFeatureIssue(issue) {
    return this.claimAndRun(issue, {
      group: { id: issue.key, stories: [] },
      startedEvent: 'feature_started',
      claimedComment: 'Claude Harness orchestrator claimed a brownfield feature request.',
      buildPrompt: (iss) => buildFeaturePrompt(iss),
      finish: (iss, grp, ws, rr) => finishExecution(this, iss, grp, ws, rr)
    });
  }

  // Shared claim -> workspace -> run -> finish spine for execution and planning.
  async claimAndRun(issue, { group, startedEvent, claimedComment, buildPrompt, finish }) {
    if (this.running.has(issue.id)) return;
    this.running.add(issue.id);
    try {
      const attempt = this.stateStore ? this.stateStore.nextAttempt(issue) : 1;
      if (this.stateStore) this.stateStore.startRun(issue, { attempt, groupId: group.id });
      this.logger.info(startedEvent, { issueKey: issue.key, groupId: group.id, attempt });
      await this.tracker.moveIssue(issue.id, this.config.tracker.runningState);
      await this.tracker.addComment(issue.id, claimedComment);
      const workspace = await this.workspaceManager.prepare(issue, group, { attempt });
      this.recordWorkspace(issue, workspace);
      await this.claudeRunner.run(workspace.workspacePath, buildPrompt(issue, group));
      const runResult = await readResult(workspace.workspacePath, group.id);
      await finish(issue, group, workspace, runResult);
    } catch (error) {
      await this.handleRunError(issue, error);
    } finally {
      this.running.delete(issue.id);
    }
  }

  recordWorkspace(issue, workspace) {
    if (workspace.resumed) {
      this.logger.info('workspace_resumed', {
        issueKey: issue.key,
        branchName: workspace.branchName,
        commitsAhead: workspace.commitsAhead,
        backupRef: workspace.backupRef
      });
    }
    if (!this.stateStore) return;
    const payload = { workspacePath: workspace.workspacePath, branchName: workspace.branchName };
    if (workspace.resumed) payload.recoveryTag = workspace.backupRef;
    this.stateStore.updateRun(issue, payload);
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
    if (workspacePath) await this.maybeCleanupWorkspace(issue, workspacePath);
  }
}

async function safeTrackerCall(promise, logger, issue) {
  try {
    return await promise;
  } catch (error) {
    logger.error('tracker_update_failed', { issueKey: issue.key, error: error.message });
    return null;
  }
}

module.exports = { Scheduler, isEligible, isStuck, issueKind, safeTrackerCall };
