'use strict';

// What command an invocation names, and what autonomy lane it declares.
//
// Split out of record-run.js, which had grown to 341 lines against a 300 cap.
// These four are a self-contained reading of the prompt text: nothing here
// touches the receipt, the telemetry push, or the filesystem, which is what
// makes them separable from the hook that uses them.

const path = require('path');
const { optionalRequire } = require('./common');

// Planning pack. Recording must never break a session: absent = skip.
const buildLane = optionalRequire(path.join(__dirname, '..', '..', 'scripts', 'build-lane.js'));

function stableLabelValue(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : value;
}

function inferCommand(prompt) {
  const text = String(prompt || '').trim();
  const match = text.match(/^\/([A-Za-z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

// An autonomy declaration, not a substring: `--auto-merge` must never read as
// `--auto`. Promoting a gated run to headless by accident is the one direction
// this can be wrong in that matters.
const AUTONOMY_FLAG = /(?:^|\s)--(auto|autonomous)(?=\s|$)/;

/**
 * The AUTONOMY lane an invocation declares, or null if it declares none.
 *
 * This used to return the command name for anything that was not /build, so
 * `/spec` wrote "spec" into .claude/state/current-lane. Two controls read that
 * marker as a lane and were wrong because of it: the decisions gate
 * corroborates a claimed `--lane --auto` against it and rejected every
 * phase-by-phase run with "a gated run cannot waive itself", and
 * gate-receipt-sensor's appliesTo() never matched a command name, so on those
 * runs it was inert — the same class of bug its own header records.
 *
 * A command name is not a lane. Returning null leaves the marker alone, so the
 * lane a session declared at its start survives the phases that follow it,
 * which is what makes it a session property rather than a per-turn one. The
 * command is recorded separately, to `current-command`.
 */
function inferLane(prompt, command) {
  if (command === 'build') {
    // Without the planning pack there is no /build lane to resolve. Unknown is
    // the honest answer; "build" would just be the command name again.
    const parsed = buildLane ? buildLane.parseBuildInvocation(prompt) : null;
    return parsed && parsed.valid !== false ? parsed.lane : null;
  }
  // /auto IS the zero-gate build loop — the command is itself the declaration.
  if (command === 'auto') return 'auto';
  const declared = AUTONOMY_FLAG.exec(String(prompt || ''));
  return declared ? declared[1] : null;
}

function shouldSkipCommandTelemetry(command) {
  return command === 'scaffold';
}

module.exports = {
  stableLabelValue, inferCommand, inferLane, shouldSkipCommandTelemetry, AUTONOMY_FLAG,
};
