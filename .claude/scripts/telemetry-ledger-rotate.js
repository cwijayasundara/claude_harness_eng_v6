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

// Walk from the tail, keeping the most recent lines that fit under maxBytes,
// but never more than keepLines. The byte cap is authoritative: even when
// lines.length <= keepLines (e.g. a steady-state of keepLines oversized
// records), bytes over the cap must still trim — that combination used to
// slip past the old "few lines, don't churn" bailout and rotation never fired.
function tailWithinBudget(lines, maxBytes, keepLines) {
  let keepCount = 0;
  let accBytes = 0;
  for (let i = lines.length - 1; i >= 0 && keepCount < keepLines; i--) {
    const lineBytes = Buffer.byteLength(lines[i], 'utf8') + 1; // +1 for the newline
    if (accBytes + lineBytes > maxBytes && keepCount > 0) break;
    accBytes += lineBytes;
    keepCount += 1;
  }
  return keepCount;
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
  if (!lines.length) return false;
  const keepCount = tailWithinBudget(lines, maxBytes, keepLines);
  if (keepCount >= lines.length) return false; // whole file already fits
  return writeRotation(ledgerFile, lines.slice(lines.length - keepCount), lines.slice(0, lines.length - keepCount));
}

module.exports = { rotateLedgerIfNeeded, MAX_LEDGER_BYTES, LEDGER_KEEP_LINES };
