'use strict';

// Composes the read-only state accessors into one normalized pipeline snapshot.
// The snapshot shape is the machine contract consumed by renderers, --json, CI,
// and e2e. See docs/internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md.

const path = require('path');
const {
  readMarker,
  readRunReceipts,
  parseList,
  pct,
  readProgress,
  readFeatures,
  countGroupsFromGraph,
  readPendingReviews,
  readPlanConfidence,
  parseIterationLog,
} = require('./pipeline-state-readers');

function buildRun(stateDir, progress, last) {
  return {
    lane: readMarker(stateDir, 'current-lane') || (last && last.lane) || null,
    mode: readMarker(stateDir, 'current-mode') || progress.mode || (last && last.mode) || null,
    session_id: (last && last.session_id) || null,
    harness_sha: (last && last.harness_sha) || null,
  };
}

function buildGroups(progress, iter) {
  const raw = progress.current_group;
  const current = raw && raw !== 'none' ? raw : null;
  return {
    completed: parseList(progress.groups_completed),
    current,
    remaining: parseList(progress.groups_remaining),
    blocked: iter.blockedGroups,
  };
}

function buildStories(progress, marker) {
  const active = parseList(progress.current_stories);
  if (active.length === 0 && marker) active.push(marker);
  return { active, blocked: parseList(progress.blocked_stories) };
}

function buildWave(groups, graphTotal) {
  const current = groups.completed.length + (groups.current ? 1 : 0);
  const total = graphTotal || (current + groups.remaining.length);
  return { current, total };
}

function buildIteration(stateDir, iter, groups) {
  const marker = readMarker(stateDir, 'current-iteration');
  const current = marker != null ? (parseInt(marker, 10) || 0) : iter.attempt;
  return {
    group: readMarker(stateDir, 'current-group') || groups.current,
    current,
    max: iter.max || 3,
  };
}

function buildCoverage(progress, iter, stateDir) {
  const fromProgress = pct(progress.coverage);
  const baselineMarker = readMarker(stateDir, 'coverage-baseline.txt');
  const baseline = baselineMarker != null ? pct(baselineMarker) : iter.baseline;
  return {
    current: fromProgress != null ? fromProgress : iter.coverage,
    baseline: baseline != null ? baseline : null,
  };
}

function buildLastStep(last) {
  if (!last) return null;
  return {
    kind: last.kind || null,
    agent: last.agent || null,
    exit: last.exit || null,
    ts: last.ts || null,
  };
}

function derivePhase(lane, progress) {
  if (/^DONE\b/i.test(progress.next_action || '')) return 'done';
  const done = parseList(progress.groups_completed).length > 0;
  const drained = progress.current_group === 'none'
    && parseList(progress.groups_remaining).length === 0;
  if (done && drained) return 'done';
  return lane || 'unknown';
}

function deriveHealth(coverage, groups, stories, iter) {
  const regressed = coverage.current != null
    && coverage.baseline != null
    && coverage.current < coverage.baseline;
  if (iter.failedOut || regressed) return 'failing';
  if (groups.blocked.length || stories.blocked.length) return 'blocked';
  return 'on_track';
}

function buildSnapshot(projectDir, { now } = {}) {
  const stateDir = path.join(projectDir, '.claude', 'state');
  const progress = readProgress(projectDir);
  const records = readRunReceipts(projectDir);
  const last = records.length ? records[records.length - 1] : null;
  const iter = parseIterationLog(stateDir);
  const groups = buildGroups(progress, iter);
  const stories = buildStories(progress, readMarker(stateDir, 'current-story'));
  const coverage = buildCoverage(progress, iter, stateDir);
  return {
    schema_version: 1,
    generated_at: now || new Date().toISOString(),
    run: buildRun(stateDir, progress, last),
    confidence: readPlanConfidence(projectDir),
    phase: derivePhase(readMarker(stateDir, 'current-lane') || (last && last.lane), progress),
    wave: buildWave(groups, countGroupsFromGraph(projectDir)),
    groups,
    stories,
    iteration: buildIteration(stateDir, iter, groups),
    features: readFeatures(projectDir),
    coverage,
    pending_reviews: readPendingReviews(stateDir),
    last_step: buildLastStep(last),
    next_action: progress.next_action || null,
    health: deriveHealth(coverage, groups, stories, iter),
  };
}

module.exports = { buildSnapshot };
