'use strict';

// Durable per-step token/cost log. phase-cost.js can already attribute a
// transcript retroactively; this writes that bill to the project so /status
// and later phases can see it without re-parsing ~/.claude/projects.
//
//   .claude/state/phase-cost.json     latest full rollup
//   .claude/state/phase-cost.jsonl    append-only step ledger (deltas)
//   .claude/state/phase-cost-cursor.json  last persisted totals
//
// Hook payloads have no usage fields. The transcript is the source of truth.

const fs = require('fs');
const path = require('path');

function loadPhaseCost() {
  // Late require: phase-cost.js's CLI requires this file only inside main(),
  // so a cycle at module load never forms.
  return require('../../scripts/phase-cost.js');
}

function tokenTotals(rows) {
  return (rows || []).reduce((acc, r) => {
    acc.input += r.input_tokens || 0;
    acc.output += r.output_tokens || 0;
    acc.cache_read += r.cache_read_tokens || 0;
    acc.cache_creation += r.cache_creation_tokens || 0;
    return acc;
  }, { input: 0, output: 0, cache_read: 0, cache_creation: 0 });
}

function fingerprint(snap) {
  const last = (snap.rows && snap.rows[snap.rows.length - 1]) || {};
  return `${snap.grand_usd}|${(snap.rows || []).length}|${last.start || ''}|${last.output_tokens || 0}`;
}

function serializeTotals(totals) {
  return (totals || []).map((t) => ({
    command: t.command,
    runs: t.runs,
    minutes: t.minutes,
    output_tokens: t.output_tokens,
    cache_read_tokens: t.cache_read_tokens,
    subagent_output_tokens: t.subagent_output_tokens,
    cost_usd: t.cost_usd,
    models: t.models instanceof Set ? [...t.models] : (t.models || []),
  }));
}

function snapshotFrom(target, opts = {}) {
  const {
    transcriptsFor, costByPhase, subagentTranscriptsFor, aggregate,
  } = loadPhaseCost();
  const files = opts.transcriptPath ? [opts.transcriptPath] : transcriptsFor(target);
  const coverage = { subagentFiles: 0, sessions: files.length };
  const rows = files.flatMap((file) => {
    const extraTranscripts = subagentTranscriptsFor(file);
    coverage.subagentFiles += extraTranscripts.length;
    return costByPhase(file, { extraTranscripts });
  }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const totals = aggregate(rows);
  const grand = totals.reduce((sum, r) => sum + r.cost_usd, 0);
  return {
    rows,
    totals,
    coverage,
    grand_usd: Math.round(grand * 10000) / 10000,
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function lastLogLine(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Persist the current transcript bill. Dedups identical fingerprints so Stop
 * firing twice without new tokens does not double-count the ledger.
 */
function writeSnapshot(projectDir, opts = {}) {
  const root = path.resolve(projectDir || process.cwd());
  const snap = snapshotFrom(opts.transcriptPath || root, opts);
  const stateDir = path.join(root, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  const latest = {
    generated_at: new Date().toISOString(),
    event: opts.event || 'snapshot',
    step: opts.step || null,
    session_id: opts.sessionId || null,
    coverage: snap.coverage,
    grand_usd: snap.grand_usd,
    rows: snap.rows,
    totals: serializeTotals(snap.totals),
  };
  fs.writeFileSync(path.join(stateDir, 'phase-cost.json'), `${JSON.stringify(latest, null, 2)}\n`);

  const logPath = path.join(stateDir, 'phase-cost.jsonl');
  const fp = fingerprint(snap);
  const prevEvent = lastLogLine(logPath);
  if (prevEvent && prevEvent.fingerprint === fp && (prevEvent.step || null) === (opts.step || null)) {
    return { ...latest, written: false, reason: 'unchanged' };
  }

  const cursorPath = path.join(stateDir, 'phase-cost-cursor.json');
  const prev = readJson(cursorPath, { grand_usd: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } });
  const tokens = tokenTotals(snap.rows);
  const prevTokens = prev.tokens || { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  const lastPhase = snap.rows.length ? snap.rows[snap.rows.length - 1].command : null;
  const event = {
    ts: latest.generated_at,
    event: opts.event || 'snapshot',
    step: opts.step || lastPhase,
    session_id: opts.sessionId || null,
    fingerprint: fp,
    grand_usd: snap.grand_usd,
    delta_usd: Math.round((snap.grand_usd - (prev.grand_usd || 0)) * 10000) / 10000,
    tokens,
    delta_tokens: {
      input: tokens.input - (prevTokens.input || 0),
      output: tokens.output - (prevTokens.output || 0),
      cache_read: tokens.cache_read - (prevTokens.cache_read || 0),
      cache_creation: tokens.cache_creation - (prevTokens.cache_creation || 0),
    },
    phases: serializeTotals(snap.totals).map((t) => ({
      command: t.command,
      runs: t.runs,
      cost_usd: t.cost_usd,
      output_tokens: t.output_tokens,
    })),
  };
  fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  fs.writeFileSync(cursorPath, `${JSON.stringify({
    grand_usd: snap.grand_usd,
    tokens,
    ts: latest.generated_at,
  })}\n`);
  return { ...latest, written: true, ledger: event };
}

module.exports = { writeSnapshot, snapshotFrom, tokenTotals, fingerprint };
