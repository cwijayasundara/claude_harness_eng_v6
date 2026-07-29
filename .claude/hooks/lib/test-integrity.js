'use strict';

// Test-integrity proof (gap G43). Pure logic over the red-phase ledger — no fs,
// no git. Plumbing lives in scripts/test-integrity-gate.js, the split
// test-deletion-gate.js and cycle-gate.js use.
//
// G42 blocks the tamper inside a session, but a turn-level gate is steppable —
// hooks can be disabled, the agent can work outside Claude Code, `--no-verify`
// exists. This is the backstop with no in-session override: pre-commit, and
// again as a required CI check.
//
// ONE invariant:
//
//   A test file must not change between the run that made it RED and the run
//   that made it GREEN.
//
// Changed → the test was weakened to pass. Unchanged → production code is what
// made it pass. The PAIR is what carries the proof; no single anchor can tell
// those apart, because a tamperer edits the test and re-runs, after which every
// single-anchor rule (latest red hash, latest green hash) agrees with itself.
//
// Deliberately silent on: still-red files (no pair yet), green-first
// characterization pin-downs (no red phase to honour), and anything after the
// pair closed (refactoring a passing test is normal work).

/**
 * Red→green cycles for one file, in order, as {red, green} event pairs.
 *
 * The anchor is the FIRST red of each cycle, not the last. Anchoring on the last
 * red let a weakened test launder itself: strip assertions but stay red, re-run
 * (which re-anchored the pair to the weakened text), then fix the one surviving
 * assertion — red and green hashes then match and the gate says nothing.
 *
 * Anchoring on the first red means any change to the test between failing and
 * passing is visible, including a change that kept it failing. Correcting a test
 * you believe is genuinely wrong therefore SURFACES rather than passing silently,
 * which is the intended outcome: from the outside, correcting and weakening are
 * indistinguishable, so a human should see it.
 */
function cyclesFor(events, file) {
  const seen = events.filter((e) => Array.isArray(e.test_files) && e.test_files.includes(file));
  // NO green-first short-circuit. It used to exempt any file whose FIRST event
  // was a pass — but that test was PATH-keyed while the lock is CONTENT-keyed, so
  // one routine green run at older text exempted a file from this gate forever,
  // which is nearly every pre-existing test file in a real repo.
  //
  // It is not needed: hash equality already gives pin-downs the right answer.
  // A pin runs green at text P, fails at text P when Step 4 flips PRODUCTION
  // code, then passes at text P again — red and green hashes match, no finding.
  const cycles = [];
  let red = null;
  for (const event of seen) {
    if (event.verdict === 'fail') {
      if (!red) red = event; // FIRST red of this cycle wins
    } else if (red) {
      cycles.push({ red, green: event });
      red = null;
    }
  }
  return cycles;
}

function hashOf(event, file) {
  return (event.file_hashes || {})[file] || null;
}

function findingFor(file, red, green) {
  const before = hashOf(red, file);
  const after = hashOf(green, file);
  if (!before || !after) {
    return {
      kind: 'unverifiable-red-phase',
      file,
      redSha: red.head_sha || null,
      detail:
        `No content hash recorded for ${file} at its red or green run, so the red-phase ` +
        'proof cannot be checked. Refusing to treat an unverifiable record as a passing one.',
    };
  }
  if (before === after) return null;
  return {
    kind: 'test-changed-between-red-and-green',
    file,
    redSha: red.head_sha || null,
    detail:
      `${file} changed between the run that made it FAIL (${red.head_sha || 'unknown sha'}) and ` +
      'the run that made it PASS. A test weakened to go green proves nothing about the code. ' +
      'Fix the production code instead, or re-run the corrected test so a new red phase is recorded.',
  };
}

/**
 * Deliberately NOT scoped by task_id. Scoping by it made the gate a self-service
 * unlock: declaring a different task (or none) emptied the event set and every
 * cycle disappeared unchecked.
 *
 * @param {object[]} events red-phase ledger events
 * @returns {{kind, file, redSha, detail}[]} one finding per offending file
 */
function integrityFindings(events) {
  const scoped = events || [];
  const files = [...new Set(scoped.flatMap((e) => e.test_files || []))].sort();
  const findings = [];
  for (const file of files) {
    for (const { red, green } of cyclesFor(scoped, file)) {
      const finding = findingFor(file, red, green);
      if (finding) {
        findings.push(finding); // first offending cycle per file is enough to block
        break;
      }
    }
  }
  return findings;
}

module.exports = { integrityFindings, cyclesFor };
