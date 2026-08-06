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
const EXPECTED_PHASES = Object.freeze({
  build: ['brd', 'spec', 'design', 'test'],
  sprint: ['brd', 'spec', 'design'],
});

// record-run writes lanes like "build --auto"; the base name carries the gates.
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

module.exports = { EXPECTED_PHASES, detectSkippedGates, baseLane };
