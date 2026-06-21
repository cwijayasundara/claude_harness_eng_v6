'use strict';

// Bounds the active telemetry ledger. It is appended on nearly every tool event
// AND re-parsed whole on each snapshot, so unbounded growth is both a disk and a
// hot-path cost (it reached 24 MB in this repo with telemetry off). When the
// active file crosses the byte ceiling, the oldest rows roll to a timestamped
// archive (gitignored) and only the most recent KEEP_LINES stay live. Called
// automatically from appendLedger — not left to the advisory archive-state.js.

const fs = require('fs');
const path = require('path');

const MAX_LEDGER_BYTES = 5 * 1024 * 1024;
const LEDGER_KEEP_LINES = 10000;

// Move `archived` rows to a timestamped archive file and rewrite the ledger with
// `keep`. Returns true on success; best-effort so a failure leaves the ledger.
function writeRotation(ledgerFile, keep, archived) {
  try {
    const archiveDir = path.join(path.dirname(ledgerFile), 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(archiveDir, `telemetry-ledger-${stamp}.jsonl`), archived.join('\n') + '\n');
    fs.writeFileSync(ledgerFile, keep.join('\n') + '\n');
    return true;
  } catch (_) {
    return false; // keep the oversized ledger rather than lose rows
  }
}

// Best-effort: any failure leaves the ledger as-is rather than breaking the
// calling hook. Returns true when a rotation happened (for tests/visibility).
function rotateLedgerIfNeeded(ledgerFile, opts = {}) {
  const maxBytes = opts.maxBytes || MAX_LEDGER_BYTES;
  const keepLines = opts.keepLines || LEDGER_KEEP_LINES;
  let bytes;
  try {
    bytes = fs.statSync(ledgerFile).size;
  } catch (_) {
    return false; // no ledger yet
  }
  if (bytes <= maxBytes) return false;
  let lines;
  try {
    lines = fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean);
  } catch (_) {
    return false;
  }
  if (lines.length <= keepLines) return false; // few but huge rows — don't churn
  return writeRotation(ledgerFile, lines.slice(lines.length - keepLines), lines.slice(0, lines.length - keepLines));
}

module.exports = { rotateLedgerIfNeeded, MAX_LEDGER_BYTES, LEDGER_KEEP_LINES };
