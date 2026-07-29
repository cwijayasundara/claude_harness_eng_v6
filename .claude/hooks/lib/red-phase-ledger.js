'use strict';

// Red-phase ledger (gap G41). Append-only, hash-chained record of observed test
// runs. Classification lives in red-phase.js; this file is the durable half.
//
// It is an integrity surface, not a log: it arms the G42 test-write-lock and
// supplies the red SHA that the G43 commit proof diffs against, so an agent that
// could silently rewrite "this test failed first" could unlock any test. Chaining
// reuses task-lifecycle.js's eventHash rather than a second implementation.
//
// THE ARMING RULE:
//
//   A test file whose FIRST observed run AT ITS CURRENT TEXT is RED arms the
//   lock. Green-first never arms.
//
// TDD is red-first by definition. Characterization (pin-down) tests are
// green-first by definition — skills/pinning-down-behavior Step 3 says "Run green
// against the current code" — and that same step explicitly permits repairing a
// pin afterwards for a nondeterministic field. Step 4 then makes those pins fail
// on purpose (flip production code, watch it bite, revert). A lock that armed on
// ANY red run would forbid the permitted repair and break the legacy lane.
//
// "At its current text" is load-bearing and was NOT in the first version, which
// keyed on (task_id, path). Review found both halves of that key were
// agent-controlled: declaring a different task emptied the ledger and released
// every lock, and running a file once before adding the failing test marked it
// green-first forever. Content is the one part of the key the agent cannot
// restate without actually changing the test — see fileState.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { eventHash } = require('./task-lifecycle');

/**
 * sha256 of a file's bytes, or null when unreadable. ONE implementation, shared
 * by the recorder (which hashes the text as it ran) and the lock (which hashes
 * the text about to be edited) — two implementations would silently disagree and
 * every lookup would miss.
 */
function hashFile(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return null;
  }
}

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
 * State for one test file AT A SPECIFIC CONTENT HASH.
 *
 * Two things are deliberately NOT keys here, both because review showed they were
 * self-service unlocks:
 *
 *  - **task_id.** It was compared by exact equality, so declaring a different
 *    task (or none) made the ledger look empty and every lock evaporate. The
 *    lock is now task-agnostic: an open red on a file locks that file, full stop.
 *  - **the file alone.** Keying first-run on the path meant the agent chose the
 *    ordering: run the file once before adding the failing test and it was
 *    marked green-first forever, so the lock never armed.
 *
 * Keying on CONTENT makes both correct without special cases:
 *  - TDD — write test (text T), run red. First verdict for T is fail → armed.
 *  - Green-first bypass — the pre-existing suite ran at text T0; adding a failing
 *    test makes the text T1, which has its own first verdict (fail) → armed.
 *  - Pin-down — the pin is written (text P) and runs GREEN at P. Step 4 flips
 *    PRODUCTION code, so the pins fail while still at text P; first verdict for P
 *    is pass → never armed, and the permitted matcher repair still works.
 *
 * `open` stays narrower than red-first: a file is locked only while its latest
 * run at this text is red. Locking for a whole task would break ordinary TDD —
 * add test 2 to a file whose test 1 passes and you are blocked by your own
 * passing work.
 *
 * @returns {{firstVerdict, latestVerdict, redFirst, open, redSha, redAt}|null}
 *   null when the ledger has never observed this file at this content.
 */
function fileState(events, testFile, contentHash) {
  const seen = (events || []).filter(
    (e) => Array.isArray(e.test_files)
      && e.test_files.includes(testFile)
      && (e.file_hashes || {})[testFile] === contentHash
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

/**
 * Files whose most recent observed run was a failure, with the content hash that
 * was failing.
 *
 * Needed because an unfiltered whole-suite green run frequently names no files at
 * all (bare `pytest` prints FAILED lines but nothing on success). Without this,
 * a red->green cycle opened by a named run could never be closed by an unnamed
 * green one, and the file would stay locked forever — fail-closed, but unusable.
 * An unfiltered green suite genuinely proves every previously-failing file passed.
 *
 * @returns {{file: string, hash: string}[]}
 */
function openRedFiles(events) {
  const latest = new Map(); // file -> {verdict, hash}
  for (const event of events || []) {
    for (const file of event.test_files || []) {
      latest.set(file, { verdict: event.verdict, hash: (event.file_hashes || {})[file] });
    }
  }
  return [...latest.entries()]
    .filter(([, v]) => v.verdict === 'fail' && v.hash)
    .map(([file, v]) => ({ file, hash: v.hash }));
}

// ------------------------------------------------------------- pre-run snapshot
//
// The recorder fires at PostToolUse, i.e. AFTER the command, so hashing the file
// then records the text as it stands when the HOOK runs — not as it stood when the
// RUNNER read it. One Bash line defeated the whole chain:
//
//   python -c "open('t.py','w').write(WEAK)" ; pytest t.py ; git checkout t.py
//
// The ledger stored pass@hash(STRONG) for a run of WEAK, so the lock opened and
// G43 compared STRONG to STRONG in silence. Neither write verb is one
// bash-targets recognises, so neither gate saw it either.
//
// pre-bash-gate already runs as PreToolUse(Bash), so it can capture the hashes
// BEFORE the command — no new hook and no settings.json change (which the
// prefix-cache gate blocks anyway).

const SNAPSHOT_REL = path.join('.claude', 'state', 'red-phase-presnap.json');

function writeSnapshot(root, command, hashes) {
  const file = path.join(root, SNAPSHOT_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ command, hashes })}\n`);
}

/** Pre-run hashes for THIS command, or {} when none apply. */
function readSnapshot(root, command) {
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(root, SNAPSHOT_REL), 'utf8'));
    // A snapshot for some other command says nothing about this one.
    return snap && snap.command === command ? (snap.hashes || {}) : {};
  } catch (_) {
    return {};
  }
}

/**
 * Which files a verdict may be attributed to, and at which hash.
 *
 * Prefers the PRE-run hash — that is the text the runner actually read. A file
 * whose text MOVED during the command is dropped entirely: we cannot tell which
 * version produced the verdict, and guessing is how the bypass above worked.
 * With no snapshot it degrades to the post-run hash (previous behaviour), which
 * is why the snapshot lives in an always-wired hook.
 */
function snapshotHashes(files, pre, post) {
  const hashes = {};
  const kept = [];
  for (const file of files) {
    const before = pre[file];
    const after = post[file];
    if (before && after && before !== after) continue; // changed mid-run — unattributable
    const hash = before || after;
    if (!hash) continue;
    hashes[file] = hash;
    kept.push(file);
  }
  return { files: kept, hashes };
}

module.exports = {
  LEDGER_REL,
  SNAPSHOT_REL,
  appendRun,
  readLedger,
  fileState,
  openRedFiles,
  hashFile,
  readSnapshot,
  writeSnapshot,
  snapshotHashes,
};
