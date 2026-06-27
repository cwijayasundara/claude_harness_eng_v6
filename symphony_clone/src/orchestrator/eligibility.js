'use strict';

// Pure predicate/routing helpers — no scheduler state. Split out so the Scheduler
// class stays focused on the polling/run loop (SRP).

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// 'plan' (PRD, plan label) | 'feature' (brownfield feature label) | 'execute' (groomed group, ready label) | null.
function issueKind(issue, config) {
  const labels = (issue.labels || []).map((label) => normalize(label));
  if (config.tracker.planLabel && labels.includes(normalize(config.tracker.planLabel))) return 'plan';
  if (config.tracker.featureLabel && labels.includes(normalize(config.tracker.featureLabel))) return 'feature';
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

module.exports = { normalize, issueKind, isEligible, isStuck };
