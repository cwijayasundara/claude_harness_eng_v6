'use strict';

// Append-only per-commit-gate outcome ledger (sensors-cli parity, feature 2a).
// Best-effort: every write is wrapped so a logging failure can NEVER change
// gate control flow. Read by loop-health (2b) to answer "which sensors never
// fire / never block?".

const fs = require('fs');
const path = require('path');

const OUTCOMES_REL = path.join('.claude', 'state', 'sensor-outcomes.jsonl');

function recordOutcome(projectDir, { sensor, ran, blocked }) {
  try {
    const file = path.join(projectDir, OUTCOMES_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { sensor: String(sensor), ran: !!ran, blocked: !!blocked, ts: Date.now() };
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch (_) {
    /* best-effort: logging must not affect the gate */
  }
}

function readOutcomes(projectDir) {
  try {
    const raw = fs.readFileSync(path.join(projectDir, OUTCOMES_REL), 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = { OUTCOMES_REL, recordOutcome, readOutcomes };
