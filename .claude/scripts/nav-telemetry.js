#!/usr/bin/env node

'use strict';

// Append-only navigation telemetry (context-pack + advisor aggregates).

const fs = require('fs');
const path = require('path');

const LOG_NAME = 'nav-telemetry.jsonl';
const SUMMARY_NAME = 'nav-telemetry-summary.json';

function logPath(projectDir) {
  return path.join(projectDir, '.claude', 'state', LOG_NAME);
}

function summaryPath(projectDir) {
  return path.join(projectDir, '.claude', 'state', SUMMARY_NAME);
}

function appendNavEvent(projectDir, event) {
  try {
    const stateDir = path.join(projectDir, '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const row = { ts: new Date().toISOString(), ...event };
    fs.appendFileSync(logPath(projectDir), `${JSON.stringify(row)}\n`);
    recomputeSummary(projectDir);
    return row;
  } catch (_) {
    return null;
  }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function recomputeSummary(projectDir) {
  const rows = readJsonl(logPath(projectDir));
  const summary = {
    updated_at: new Date().toISOString(),
    pack_requests: 0,
    pack_by_status: {},
    pack_no_match: 0,
    pack_low_confidence: 0,
    pack_ok: 0,
    semantic_hits: 0,
    cochange_hits: 0,
    advisor_context_search_skipped: 0,
    advisor_broad_source_read: 0,
  };
  for (const r of rows) {
    if (r.kind === 'context_pack') {
      summary.pack_requests += 1;
      const st = r.status || 'unknown';
      summary.pack_by_status[st] = (summary.pack_by_status[st] || 0) + 1;
      if (st === 'no_match') summary.pack_no_match += 1;
      if (st === 'low_confidence') summary.pack_low_confidence += 1;
      if (st === 'ok') summary.pack_ok += 1;
      if (r.semantic_hits) summary.semantic_hits += r.semantic_hits;
      if (r.cochange_hits) summary.cochange_hits += r.cochange_hits;
    }
    if (r.kind === 'token_advisor') {
      if (r.warning_kind === 'context_search_skipped') summary.advisor_context_search_skipped += 1;
      if (r.warning_kind === 'broad_source_read') summary.advisor_broad_source_read += 1;
    }
  }
  try {
    fs.writeFileSync(summaryPath(projectDir), `${JSON.stringify(summary, null, 2)}\n`);
  } catch (_) { /* ignore */ }
  return summary;
}

function readNavTelemetrySummary(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(summaryPath(projectDir), 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = {
  appendNavEvent,
  recomputeSummary,
  readNavTelemetrySummary,
  LOG_NAME,
  SUMMARY_NAME,
};
