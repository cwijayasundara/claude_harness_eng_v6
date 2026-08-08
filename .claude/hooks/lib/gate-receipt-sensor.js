'use strict';

// Skipped-gate sensor (R7, detect-not-block).
//
// The audited run left no brd-approval.json and no design-approval.json: two of
// three planning gates did not happen, and the run looked entirely normal. The
// missing property was not enforcement — it was VISIBILITY. Nobody could tell
// afterwards.
//
// Why this is a sensor and not a gate. Hooks fire on tool calls, and there is no
// phase-transition event to gate, so "do not proceed past Phase N" has no hook
// counterpart. And plan-approval's phaseRan tests directory existence, not
// authorship: in any repo that has run /build once, specs/brd|stories|design are
// populated forever after, so a hook keyed on that would block every later
// /feature, /change, /vibe and /refactor — lanes that reach /auto writing no BRD
// at all. Detecting is available and honest; blocking is not.
//
// Pure: the caller injects phaseRan/readReceipt, so the rules are testable
// without a filesystem.

// Which lanes own which planning gates. Explicit rather than derived, so adding
// a lane is a decision someone makes rather than a side effect.
//
// These are the values record-run.js actually writes to .claude/state/current-lane
// — parseBuildInvocation().lane from build-lane.js, NOT the command name. An
// earlier version keyed on "build", which record-run never writes, so the sensor
// was inert for every real /build run: the exact incident it exists to detect.
//
// A headless lane still expects receipts. `--auto` and `--autonomous` skip the
// human loops but /build's collapsed-lane step waives each phase explicitly, so
// an absent receipt there means even the waiver did not happen — which is the
// same silence, and a waiver is not treated as a finding.
const PLANNING_PHASES = ['brd', 'spec', 'design', 'test'];
const EXPECTED_PHASES = Object.freeze({
  gated: PLANNING_PHASES,
  auto: PLANNING_PHASES,
  autonomous: PLANNING_PHASES,
  lite: PLANNING_PHASES,
  'lite-auto': PLANNING_PHASES,
  'lite-autonomous': PLANNING_PHASES,
  // finalize runs Phases 9-11 only — it never reaches a planning gate.
  sprint: ['brd', 'spec', 'design'],
});

// Defensive only: record-run writes a single normalized token, never a phrase.
function baseLane(lane) {
  return String(lane || '').trim().split(/\s+/)[0];
}

/**
 * @param {string} lane the session lane (.claude/state/current-lane)
 * @param {{phaseRan: (p:string)=>boolean, readReceipt: (p:string)=>object|null}} io
 * @returns {Array<{phase: string, reason: string}>} empty when nothing was skipped
 */
function detectSkippedGates(lane, io) {
  const phases = EXPECTED_PHASES[baseLane(lane)];
  if (!phases) return [];

  const findings = [];
  for (const phase of phases) {
    // A phase that never ran has not been skipped — it has not been reached.
    if (!io.phaseRan(phase)) continue;
    const receipt = io.readReceipt(phase);
    if (!receipt) {
      findings.push({ phase, reason: `${phase} produced artifacts but recorded no receipt — the gate did not run` });
      continue;
    }
    // A waiver is a deliberately-headless run. That is a different fact from a
    // gate nobody ran, and plan-approval already records which one it was.
    if (receipt.status === 'waived' || receipt.status === 'approved') continue;
    findings.push({ phase, reason: `${phase} review is "${receipt.status}" — it never reached an approving round` });
  }
  return findings;
}

// Whether this sensor has anything to check for a lane at all.
//
// detectSkippedGates returns [] both for "not applicable" and for "applicable,
// nothing wrong" — different facts. Without this the hook recorded ran:true on
// every Stop of every lane, so the value meter saw a control that looked
// maximally active while doing nothing in most sessions. A control that
// overstates its own activity cannot be judged on whether it earns its keep.
function appliesTo(lane) {
  return Boolean(EXPECTED_PHASES[baseLane(lane)]);
}

module.exports = {
  EXPECTED_PHASES, detectSkippedGates, appliesTo, baseLane,
};
