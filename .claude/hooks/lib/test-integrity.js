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

/** Red→green cycles for one file, in order, as {red, green} event pairs. */
function cyclesFor(events, file) {
  const seen = events.filter((e) => Array.isArray(e.test_files) && e.test_files.includes(file));
  if (!seen.length || seen[0].verdict !== 'fail') return []; // green-first: no red phase
  const cycles = [];
  let red = null;
  for (const event of seen) {
    // The LAST red before a green is the anchor: re-running red after correcting
    // a test is the declared way to fix one, and it re-anchors the pair.
    if (event.verdict === 'fail') red = event;
    else if (red) {
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
 * @param {object[]} events red-phase ledger events
 * @param {string|null} taskId active task id
 * @returns {{kind, file, redSha, detail}[]} one finding per offending file
 */
function integrityFindings(events, taskId) {
  const scoped = (events || []).filter((e) => e.task_id === taskId);
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
