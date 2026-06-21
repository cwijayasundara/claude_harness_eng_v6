'use strict';

const { buildHarnessPrompt, groupFromIssue } = require('./prompt-builder');
const { buildPlanningPrompt } = require('./planning-prompt');
const { readResult, buildProofComment } = require('./result-reader');
const { maybeCreatePr, enableAutoMerge } = require('./pr');

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
        await this.completeHumanReview(issue, group, workspace, runResult);
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

  // Route by issue kind: a PRD (plan label) runs the architect planning pipeline;
  // a groomed group (ready label) runs execution. Same claim/workspace/run spine.
  dispatchIssue(issue) {
    return issueKind(issue, this.config) === 'plan'
      ? this.runPlanningIssue(issue)
      : this.runIssue(issue);
  }

  // Architect stage: PRD -> /brd -> /spec -> /design -> /test -> /tracker-publish,
  // which publishes the per-cluster group issues the execution path then claims.
  async runPlanningIssue(issue) {
    if (this.running.has(issue.id)) return;
    this.running.add(issue.id);
    try {
      const attempt = this.stateStore ? this.stateStore.nextAttempt(issue) : 1;
      if (this.stateStore) this.stateStore.startRun(issue, { attempt, groupId: issue.key });
      this.logger.info('plan_started', { issueKey: issue.key, attempt });
      await this.tracker.moveIssue(issue.id, this.config.tracker.runningState);
      await this.tracker.addComment(issue.id, 'Claude Harness orchestrator claimed PRD for planning.');
      const workspace = await this.workspaceManager.prepare(issue, { id: issue.key, stories: [] }, { attempt });
      if (this.stateStore) this.stateStore.updateRun(issue, { workspacePath: workspace.workspacePath, branchName: workspace.branchName });
      await this.claudeRunner.run(workspace.workspacePath, buildPlanningPrompt(issue));
      const runResult = await readResult(workspace.workspacePath, issue.key);
      await this.finishPlanning(issue, workspace, runResult);
    } catch (error) {
      await this.handleRunError(issue, error);
    } finally {
      this.running.delete(issue.id);
    }
  }

  async finishPlanning(issue, workspace, runResult) {
    const t = this.config.tracker;
    if (runResult.result.status === 'planned') {
      const groups = (runResult.result.groups_published || []).join(', ') || 'see specs/';
      await this.tracker.addComment(issue.id, `Planning complete. Published groups: ${groups}.`);
      await this.tracker.moveIssue(issue.id, t.plannedState, t.plannedStateCandidates);
      if (this.stateStore) this.stateStore.finishRun(issue, { status: 'planned', workspacePath: workspace.workspacePath });
      this.logger.info('plan_completed', { issueKey: issue.key });
    } else {
      await this.tracker.addComment(issue.id, `Planning blocked: ${runResult.result.blocker || runResult.result.summary || 'unknown'}`);
      await this.tracker.moveIssue(issue.id, t.blockedState, t.blockedStateCandidates);
      if (this.stateStore) this.stateStore.finishRun(issue, { status: 'blocked' });
      this.logger.warn('plan_blocked', { issueKey: issue.key });
    }
    await this.maybeCleanupWorkspace(issue, workspace.workspacePath);
  }

  async maybeCleanupWorkspace(issue, workspacePath) {
    if (!this.workspaceManager || typeof this.workspaceManager.cleanup !== 'function') return;
    try {
      await this.workspaceManager.cleanup(workspacePath);
    } catch (error) {
      this.logger.error('workspace_cleanup_failed', { issueKey: issue.key, workspacePath, error: error.message });
    }
  }

  // A run that reached human_review has passed the harness's own gates (ratchet,
  // /gate, Phase 9.5). Push, open the PR, post proof, then either enable
  // auto-merge (CI becomes the final machine gate) or hand to a human.
  async completeHumanReview(issue, group, workspace, runResult) {
    await this.workspaceManager.pushBranch(workspace.workspacePath, workspace.branchName);
    const prUrl = await maybeCreatePr(workspace.workspacePath, issue, group, this.config);
    await this.tracker.addComment(issue.id, buildProofComment(issue, group, runResult, prUrl));
    const outcome = await this.resolveReviewOutcome(issue, workspace, prUrl);
    await this.tracker.moveIssue(issue.id, outcome.state, outcome.candidates);
    if (this.stateStore) {
      this.stateStore.finishRun(issue, { status: outcome.runStatus, branchName: workspace.branchName, workspacePath: workspace.workspacePath, prUrl });
    }
    this.logger.info('run_completed', { issueKey: issue.key, groupId: group.id, prUrl, outcome: outcome.runStatus });
    await this.maybeCleanupWorkspace(issue, workspace.workspacePath);
  }

  // Default: hand to a human (reviewState). With AUTO_MERGE on, enable GitHub
  // native auto-merge — GitHub merges only once required checks pass, so a red
  // build never lands — and move to the done state. Failure to enable falls back
  // to human review rather than silently dropping the PR.
  async resolveReviewOutcome(issue, workspace, prUrl) {
    const t = this.config.tracker;
    const am = this.config.autoMerge;
    if (!am || !am.enabled) {
      return { state: t.reviewState, candidates: t.reviewStateCandidates, runStatus: 'human_review' };
    }
    const merge = await this.enableAutoMerge(prUrl, workspace.workspacePath, this.config);
    if (merge && merge.enabled) {
      await this.tracker.addComment(issue.id, `Auto-merge enabled (${am.method}); GitHub will merge once required checks pass.`);
      return { state: am.doneState, candidates: am.doneStateCandidates, runStatus: 'auto_merge' };
    }
    await this.tracker.addComment(issue.id, `Auto-merge could not be enabled (${(merge && merge.reason) || 'unknown'}); left for human review.`);
    return { state: t.reviewState, candidates: t.reviewStateCandidates, runStatus: 'human_review' };
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

// 'plan' (PRD, plan label) | 'execute' (groomed group, ready label) | null.
function issueKind(issue, config) {
  const labels = (issue.labels || []).map((label) => normalize(label));
  if (config.tracker.planLabel && labels.includes(normalize(config.tracker.planLabel))) return 'plan';
  if (labels.includes(normalize(config.tracker.readyLabel))) return 'execute';
  return null;
}

function isEligible(issue, config) {
  const stateMatches = normalize(issue.state) === normalize(config.tracker.readyState);
  const blockersDone = issue.blockedBy.every((blocker) =>
    config.tracker.terminalStates.map(normalize).includes(normalize(blocker.state))
  );
  return stateMatches && Boolean(issueKind(issue, config)) && blockersDone;
}

function isStuck(issue, runningSet, config) {
  const inRunningState = normalize(issue.state) === normalize(config.tracker.runningState);
  const claimedByThisProcess = runningSet && runningSet.has(issue.id);
  return inRunningState && !claimedByThisProcess;
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

module.exports = { Scheduler, isEligible, isStuck, issueKind, safeTrackerCall };
