'use strict';

// Red-phase ledger (gap G41). Append-only, hash-chained record of observed test
// runs. Classification lives in red-phase.js; this file is the durable half.
//
// It is an integrity surface, not a log: it arms the G42 test-write-lock and
// supplies the red SHA that the G43 commit proof diffs against, so an agent that
// could silently rewrite "this test failed first" could unlock any test. Chaining
// reuses task-lifecycle.js's eventHash rather than a second implementation.
//
// THE ARMING RULE, and why it is first-run rather than any-run:
//
//   A test file whose FIRST observed run (within a task) is RED arms the lock.
//   Green-first never arms.
//
// TDD is red-first by definition. Characterization (pin-down) tests are
// green-first by definition — skills/pinning-down-behavior Step 3 says "Run green
// against the current code" — and that same step explicitly permits repairing a
// pin afterwards for a nondeterministic field. Step 4 then makes those pins fail
// on purpose (flip production code, watch it bite, revert). A lock that armed on
// ANY red run would forbid the permitted repair and break the legacy lane. Keying
// on the first run separates the two disciplines with no lane special-casing, and
// no knowledge of the mutation-smoke wrapper.

const fs = require('fs');
const path = require('path');
const { eventHash } = require('./task-lifecycle');

const LEDGER_REL = path.join('.claude', 'state', 'red-phase.jsonl');
const VERDICTS = new Set(['pass', 'fail']);

function ledgerFile(root) {
  return path.join(root, LEDGER_REL);
}

function validateEvent(events, event, index) {
  const errors = [];
  const previous = events[index - 1];
  if (event.sequence !== index + 1) errors.push(`sequence mismatch at ${index + 1}`);
  if (event.previous_event_hash !== (previous ? previous.event_hash : null)) {
    errors.push(`chain mismatch at ${index + 1}`);
  }
  if (event.event_hash !== eventHash(event)) errors.push(`event hash mismatch at ${index + 1}`);
  return errors;
}

/**
 * @returns {{state: 'absent'|'valid'|'invalid', file: string, events: object[], errors: string[]}}
 */
function readLedger(root) {
  const file = ledgerFile(root);
  if (!fs.existsSync(file)) return { state: 'absent', file, events: [], errors: [] };
  const errors = [];
  const events = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const [index, line] of lines.entries()) {
    try {
      const event = JSON.parse(line);
      errors.push(...validateEvent(events, event, index));
      events.push(event);
    } catch (err) {
      errors.push(`unparseable event ${index + 1}: ${err.message}`);
    }
  }
  return { state: errors.length ? 'invalid' : 'valid', file, events, errors };
}

// Throw rather than record anything that is not evidence. A broken environment
// or a run naming no file proves nothing, and recording it would arm a lock
// against a test that never ran.
function validateRun(run) {
  if (!VERDICTS.has(run.verdict)) {
    throw new Error(`refusing to record verdict "${run.verdict}" (env-broken runs are not evidence)`);
  }
  if (!Array.isArray(run.test_files) || run.test_files.length === 0) {
    throw new Error('refusing to record a run naming no test_files');
  }
  // Content hashes are what make the G43 proof exact: "did this test change
  // between the run that made it red and the run that made it green". Without
  // them the ledger records only that a run happened, which says nothing about
  // WHICH test text was running.
  if (!run.file_hashes || run.test_files.some((f) => !run.file_hashes[f])) {
    throw new Error('refusing to record a run without a content hash for every test file');
  }
}

/** Append one observed test run. */
function appendRun(root, run, now = new Date()) {
  validateRun(run);
  const ledger = readLedger(root);
  if (ledger.state === 'invalid') throw new Error(ledger.errors.join('; '));
  const previous = ledger.events[ledger.events.length - 1] || null;
  const event = {
    schema_version: 1,
    sequence: ledger.events.length + 1,
    task_id: run.task_id || null,
    runner: run.runner || null,
    verdict: run.verdict,
    test_files: [...run.test_files].sort(),
    file_hashes: run.file_hashes,
    head_sha: run.head_sha || null,
    command: run.command || null,
    at: now.toISOString(),
    previous_event_hash: previous ? previous.event_hash : null,
  };
  event.event_hash = eventHash(event);
  fs.mkdirSync(path.dirname(ledger.file), { recursive: true });
  fs.appendFileSync(ledger.file, `${JSON.stringify(event)}\n`);
  return event;
}

/**
 * First-observed verdict, latest verdict, and latest red anchor for one
 * (task, test file).
 *
 * `open` is what the G42 lock keys on, and it is deliberately narrower than
 * red-first alone: a file is locked only while its LATEST run is still red.
 * Locking for the whole task would break ordinary TDD — write test 1, go green,
 * then add test 2 to the same file and you would be blocked by your own passing
 * work. The tamper actually worth blocking is the narrow one: the test is
 * failing, and the agent edits the TEST instead of the production code. Once the
 * file legitimately goes green, the cycle is closed and the next red re-arms it.
 *
 * @returns {{firstVerdict, latestVerdict, redFirst, open, redSha, redAt}|null}
 *   null when the ledger has never seen this file under this task.
 */
function fileState(events, taskId, testFile) {
  const seen = (events || []).filter(
    (e) => e.task_id === taskId && Array.isArray(e.test_files) && e.test_files.includes(testFile)
  );
  if (!seen.length) return null;
  const reds = seen.filter((e) => e.verdict === 'fail');
  const latestRed = reds[reds.length - 1] || null;
  const redFirst = seen[0].verdict === 'fail';
  const latestVerdict = seen[seen.length - 1].verdict;
  return {
    firstVerdict: seen[0].verdict,
    latestVerdict,
    redFirst,
    open: redFirst && latestVerdict === 'fail',
    redSha: latestRed ? latestRed.head_sha : null,
    redAt: latestRed ? latestRed.at : null,
  };
}

module.exports = { LEDGER_REL, appendRun, readLedger, fileState };
