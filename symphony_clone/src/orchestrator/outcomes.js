'use strict';

// Run-result handlers: given a finished run, advance tracker state and clean up.
// Free functions taking the scheduler (`sched`) so the Scheduler class stays the
// polling/run loop and these stay independently testable (SRP).

const { maybeCreatePr } = require('./pr');
const { buildProofComment } = require('./result-reader');

async function finishExecution(sched, issue, group, workspace, runResult) {
  if (runResult.result.status === 'human_review') {
    await completeHumanReview(sched, issue, group, workspace, runResult);
    return;
  }
  await sched.tracker.addComment(issue.id, buildProofComment(issue, group, runResult, null));
  await sched.tracker.moveIssue(issue.id, sched.config.tracker.blockedState, sched.config.tracker.blockedStateCandidates);
  if (sched.stateStore) sched.stateStore.finishRun(issue, { status: 'blocked' });
  sched.logger.warn('run_blocked', { issueKey: issue.key, groupId: group.id });
  await sched.maybeCleanupWorkspace(issue, workspace.workspacePath);
}

async function finishPlanning(sched, issue, group, workspace, runResult) {
  const t = sched.config.tracker;
  if (runResult.result.status === 'planned') {
    const groups = (runResult.result.groups_published || []).join(', ') || 'see specs/';
    await sched.tracker.addComment(issue.id, `Planning complete. Published groups: ${groups}.`);
    await sched.tracker.moveIssue(issue.id, t.plannedState, t.plannedStateCandidates);
    if (sched.stateStore) sched.stateStore.finishRun(issue, { status: 'planned', workspacePath: workspace.workspacePath });
    sched.logger.info('plan_completed', { issueKey: issue.key });
  } else {
    await sched.tracker.addComment(issue.id, `Planning blocked: ${runResult.result.blocker || runResult.result.summary || 'unknown'}`);
    await sched.tracker.moveIssue(issue.id, t.blockedState, t.blockedStateCandidates);
    if (sched.stateStore) sched.stateStore.finishRun(issue, { status: 'blocked' });
    sched.logger.warn('plan_blocked', { issueKey: issue.key });
  }
  await sched.maybeCleanupWorkspace(issue, workspace.workspacePath);
}

// A run that reached human_review has passed the harness's own gates (ratchet,
// /gate, Phase 9.5). Push, open the PR, post proof, then either enable auto-merge
// (CI becomes the final machine gate) or hand to a human.
async function completeHumanReview(sched, issue, group, workspace, runResult) {
  await sched.workspaceManager.pushBranch(workspace.workspacePath, workspace.branchName);
  const prUrl = await maybeCreatePr(workspace.workspacePath, issue, group, sched.config);
  await sched.tracker.addComment(issue.id, buildProofComment(issue, group, runResult, prUrl));
  const outcome = await resolveReviewOutcome(sched, issue, workspace, prUrl);
  await sched.tracker.moveIssue(issue.id, outcome.state, outcome.candidates);
  if (sched.stateStore) {
    sched.stateStore.finishRun(issue, { status: outcome.runStatus, branchName: workspace.branchName, workspacePath: workspace.workspacePath, prUrl });
  }
  sched.logger.info('run_completed', { issueKey: issue.key, groupId: group.id, prUrl, outcome: outcome.runStatus });
  await sched.maybeCleanupWorkspace(issue, workspace.workspacePath);
}

// Default: hand to a human (reviewState). With AUTO_MERGE on, enable GitHub native
// auto-merge — GitHub merges only once required checks pass, so a red build never
// lands — and move to the done state. Failure to enable falls back to human review.
async function resolveReviewOutcome(sched, issue, workspace, prUrl) {
  const t = sched.config.tracker;
  const am = sched.config.autoMerge;
  if (!am || !am.enabled) {
    return { state: t.reviewState, candidates: t.reviewStateCandidates, runStatus: 'human_review' };
  }
  const merge = await sched.enableAutoMerge(prUrl, workspace.workspacePath, sched.config);
  if (merge && merge.enabled) {
    await sched.tracker.addComment(issue.id, `Auto-merge enabled (${am.method}); GitHub will merge once required checks pass.`);
    return { state: am.doneState, candidates: am.doneStateCandidates, runStatus: 'auto_merge' };
  }
  await sched.tracker.addComment(issue.id, `Auto-merge could not be enabled (${(merge && merge.reason) || 'unknown'}); left for human review.`);
  return { state: t.reviewState, candidates: t.reviewStateCandidates, runStatus: 'human_review' };
}

module.exports = { finishExecution, finishPlanning, completeHumanReview, resolveReviewOutcome };
