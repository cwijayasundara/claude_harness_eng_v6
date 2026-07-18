'use strict';

// Ordered pre-commit gate catalog + tier-filtered runner (PR3).

const { isGateEnabled, loadSensorTier } = require('./sensor-tier');
const { buildContext, setFailContext, fail } = require('./pre-commit-util');
const { recordOutcome } = require('./sensor-outcomes');
const early = require('./gates-early');
const legacy = require('./gates-legacy');
const quality = require('./gates-quality');
const liveExternals = require('./gates-live-externals');

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
  { id: 'stub-smell-gate', order: 35, runsWithoutSource: true, run: early.checkStubSmellGate },
  // live-externals is runsWithoutSource:true so it fires on a test-only commit
  // (a new tests/integration file with no other source), like test-deletion-guard.
  { id: 'live-externals', order: 36, runsWithoutSource: true, run: liveExternals.checkLiveExternalsGate },
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
  // Secure-repo baseline (strict): secrets must be caught even on a docs/config-only
  // commit, so both run without staged source (Increment 1).
  { id: 'security-baseline', order: 160, runsWithoutSource: true, run: strictRun('checkSecurityBaseline') },
  { id: 'secure-baseline-wiring', order: 165, runsWithoutSource: true, run: strictRun('checkSecureBaselineWiring') },
  { id: 'cycle-detection', order: 200, runsWithoutSource: false, run: strictRun('checkCycleDetection') },
  { id: 'coupling-ratchet', order: 210, runsWithoutSource: false, run: strictRun('checkCouplingRatchet') },
  { id: 'duplication-ratchet', order: 220, runsWithoutSource: false, run: strictRun('checkDuplicationRatchet') },
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
  process.stdout.write(`pre-commit: sensor_tier=${tier}\n`);

  // Phase A: gates that run even for docs-only / delete-only commits
  for (const g of selectGates(tier, { withoutSourceOnly: true })) {
    setFailContext({ tier, currentSensor: g.id, projectDir });
    g.run(ctx);
    recordOutcome(projectDir, { sensor: g.id, ran: true, blocked: false });
  }

  // Historical source-only exit (after secrets / amendment / test-deletion)
  if (ctx.stagedSource.length === 0) return { tier, ranSourceGates: false };

  // Phase B: remaining gates enabled for this tier (includes withoutSource ones already run — skip them)
  for (const g of selectGates(tier)) {
    if (g.runsWithoutSource) continue;
    setFailContext({ tier, currentSensor: g.id, projectDir });
    g.run(ctx);
    recordOutcome(projectDir, { sensor: g.id, ran: true, blocked: false });
  }

  runCommitCustomSensors(projectDir);
  return { tier, ranSourceGates: true };
}

/**
 * Run project-manifest.json#custom_sensors[] entries with cadence:'commit'.
 * Report-only entries (blocking:false) log and continue; blocking entries
 * call fail() (process.exit(1)) on failure. Skips silently if the runner
 * script is absent (e.g. hook fixtures without .claude/scripts/).
 */
function runCommitCustomSensors(projectDir) {
  let runAll;
  try { ({ runAll } = require('../../scripts/run-custom-sensors')); }
  catch (_) { return; } // runner absent (e.g. hook fixture) → skip silently
  const { sensors } = runAll(projectDir, { cadence: 'commit' });
  for (const s of sensors) {
    setFailContext({ currentSensor: `custom:${s.id}`, projectDir });
    if (s.blocking && !s.result.success) {
      // fail() self-records the blocked outcome for currentSensor before exiting,
      // so it is the sole recorder on the block path (no double-write).
      fail(`\nBLOCKED: custom sensor "${s.id}" — ${s.result.summary}\n`);
    } else {
      recordOutcome(projectDir, { sensor: `custom:${s.id}`, ran: true, blocked: false });
    }
  }
}

module.exports = {
  GATE_CATALOG,
  selectGates,
  runPreCommit,
  runCommitCustomSensors,
};
