'use strict';

// Ordered pre-commit gate catalog + tier-filtered runner (PR3).

const { isGateEnabled, loadSensorTier } = require('./sensor-tier');
const { buildContext } = require('./pre-commit-util');
const early = require('./gates-early');
const legacy = require('./gates-legacy');
const quality = require('./gates-quality');

// Strict gates lazy-loaded so standard/minimal pre-commit never requires
// coupling-gate → drift.js → code-map scripts (absent in hook fixtures).
function strictRun(name) {
  return (ctx) => require('./gates-strict')[name](ctx);
}

/**
 * Catalog of commit-time gates. Order matches the historical pre-commit hook.
 * runsWithoutSource: true → runs even when no source files are staged (docs-only commits).
 */
const GATE_CATALOG = Object.freeze([
  { id: 'secret-scan', order: 10, runsWithoutSource: true, run: early.checkSecrets },
  { id: 'amendment-provenance', order: 20, runsWithoutSource: true, run: early.checkAmendmentProvenance },
  { id: 'test-deletion-guard', order: 30, runsWithoutSource: true, run: early.checkTestDeletionGate },
  // source-only exit sits here in the runner
  { id: 'refactor-purity', order: 40, runsWithoutSource: false, run: early.checkRefactorPurity },
  { id: 'layer-imports', order: 50, runsWithoutSource: false, run: early.checkLayers },
  { id: 'bounded-context-rules', order: 60, runsWithoutSource: false, run: early.checkContexts },
  { id: 'ownership-check', order: 70, runsWithoutSource: false, run: early.checkOwnership },
  { id: 'legacy-discipline-proof', order: 80, runsWithoutSource: false, run: legacy.checkLegacyDisciplineGate },
  { id: 'sprout-diff', order: 90, runsWithoutSource: false, run: legacy.checkSproutDiffGate },
  { id: 'at-first-gate', order: 100, runsWithoutSource: false, run: legacy.checkAtFirstGate },
  { id: 'sprint-contract', order: 110, runsWithoutSource: false, run: quality.checkSprintContract },
  { id: 'type-check', order: 120, runsWithoutSource: false, run: quality.checkTypescript },
  { id: 'coverage-ratchet-py', order: 130, runsWithoutSource: false, run: quality.checkCoverage },
  { id: 'coverage-ratchet-js', order: 140, runsWithoutSource: false, run: quality.checkCoverageJs },
  { id: 'mutation-smoke', order: 150, runsWithoutSource: false, run: quality.checkMutation },
  { id: 'cycle-detection', order: 200, runsWithoutSource: false, run: strictRun('checkCycleDetection') },
  { id: 'coupling-ratchet', order: 210, runsWithoutSource: false, run: strictRun('checkCouplingRatchet') },
]);

function selectGates(tier, { withoutSourceOnly = false } = {}) {
  return GATE_CATALOG
    .filter((g) => isGateEnabled(tier, g.id))
    .filter((g) => (withoutSourceOnly ? g.runsWithoutSource : true))
    .slice()
    .sort((a, b) => a.order - b.order);
}

/**
 * Run the full pre-commit sequence for projectDir.
 * process.exit(1) on block (via fail()); returns normally on pass.
 */
function runPreCommit(projectDir, opts = {}) {
  const env = opts.env || process.env;
  const tier = opts.tier || loadSensorTier(projectDir, env);
  const ctx = buildContext(projectDir);
  ctx.tier = tier;

  // Phase A: gates that run even for docs-only / delete-only commits
  for (const g of selectGates(tier, { withoutSourceOnly: true })) {
    g.run(ctx);
  }

  // Historical source-only exit (after secrets / amendment / test-deletion)
  if (ctx.stagedSource.length === 0) return { tier, ranSourceGates: false };

  // Phase B: remaining gates enabled for this tier (includes withoutSource ones already run — skip them)
  for (const g of selectGates(tier)) {
    if (g.runsWithoutSource) continue;
    g.run(ctx);
  }

  return { tier, ranSourceGates: true };
}

module.exports = {
  GATE_CATALOG,
  selectGates,
  runPreCommit,
};
