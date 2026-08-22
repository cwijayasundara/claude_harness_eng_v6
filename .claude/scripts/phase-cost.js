#!/usr/bin/env node

'use strict';

// Per-phase token + cost attribution, read back out of the session transcript.
//
// Why not the telemetry ledger: hook payloads carry no token/cost/model fields,
// so `.claude/state/telemetry-ledger.jsonl` has never recorded spend. The
// transcript does — every slash command as a user turn, every usage block on
// the assistant turns — so a phase bill is recoverable retroactively, offline,
// with no collector and no OTEL endpoint.
//
// Usage:
//   node .claude/scripts/phase-cost.js [transcriptPath|projectDir] [--json]
//   node .claude/scripts/phase-cost.js            # this project, all sessions
//   node .claude/scripts/phase-cost.js --write [--step NAME]   # persist to .claude/state/

const fs = require('fs');
const path = require('path');
const {
  segmentsFromTranscript, costByPhase, commandOf, aggregate,
  subagentTranscriptsFor, transcriptsFor, cacheProfile, turnProfile, FREEFORM,
} = require('../hooks/lib/phase-cost-core.js');

function pad(value, width, left = false) {
  const s = String(value);
  return left ? s.padStart(width) : s.padEnd(width);
}

// A model billed at the default (Opus) rate because it has no price entry makes
// the total a guess. Computing that and never printing it is the same silence
// the coverage note exists to break.
function unpricedNote(rows) {
  const unpriced = [...new Set(rows.flatMap((r) => r.unpriced_models || []))];
  if (unpriced.length === 0) return [];
  return [
    `NOTE: no price entry for ${unpriced.join(', ')} — billed at the default rate.`,
    '      Add them to .claude/hooks/lib/model-pricing.js; until then the total is an estimate.',
  ];
}

// A partial bill must never read as a total.
function coverageNote(coverage) {
  if (coverage.subagentFiles === 0) {
    return [
      'NOTE: no subagent transcripts found (they are temp files, cleaned after the session).',
      '      Figures are MAIN-LOOP ONLY and undercount every phase that spawned agents.',
    ];
  }
  return [`Subagent transcripts pooled: ${coverage.subagentFiles} across ${coverage.sessions} session(s).`];
}

function renderRow(r, width) {
  return pad(r.command === FREEFORM ? r.command : `/${r.command}`, width)
    + pad(r.runs, 6, true)
    + pad(r.minutes, 7, true)
    + pad(r.output_tokens.toLocaleString(), 12, true)
    + pad(r.subagent_output_tokens.toLocaleString(), 12, true)
    + pad(`$${r.cost_usd.toFixed(2)}`, 10, true)
    + '  ' + [...r.models].join(', ');
}

function render(rows, coverage) {
  const totals = aggregate(rows);
  const grand = totals.reduce((sum, r) => sum + r.cost_usd, 0);
  const w = Math.max(14, ...totals.map((r) => r.command.length + 2));
  const head = `${pad('phase', w)}${pad('runs', 6, true)}${pad('min', 7, true)}`
    + `${pad('out tok', 12, true)}${pad('subagent', 12, true)}${pad('cost', 10, true)}  models`;
  const rule = '-'.repeat(w + 49);
  return ['', head, rule,
    ...totals.map((r) => renderRow(r, w)),
    rule,
    `${pad('TOTAL', w)}${pad('', 37)}${pad(`$${grand.toFixed(2)}`, 10, true)}`,
    '', ...unpricedNote(rows), ...coverageNote(coverage), ''].join('\n');
}

function parseCli(argv) {
  const opts = { json: false, write: false, step: null, target: null, why: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--write') opts.write = true;
    else if (a === '--step') opts.step = argv[++i] || null;
    else if (a === '--why') opts.why = true;
    else if (!a.startsWith('--') && !opts.target) opts.target = a;
  }
  opts.target = opts.target || process.cwd();
  return opts;
}

// The cost table says WHAT a phase cost. On this harness the answer to WHY is
// almost always cache: measured over the 2026-08-21 sprint-1 baseline, output
// was $2.70 of $47.97 and the rest was context re-reads plus cache writes.
// A phase that idles past the 5-minute TTL rewrites its whole context at 1.25x
// base, and neither the miss nor the idle gap that caused it appears in a bill.
function renderWhy(profiles) {
  const byCommand = new Map();
  for (const p of profiles) {
    const cur = byCommand.get(p.command) || {
      command: p.command, cache_read_tokens: 0, cache_write_tokens: 0,
      ttl_5m_tokens: 0, ttl_1h_tokens: 0, full_misses: 0, full_miss_tokens: 0,
      wasted_usd: 0, idle_gaps_sec: [],
    };
    for (const k of ['cache_read_tokens', 'cache_write_tokens', 'ttl_5m_tokens', 'ttl_1h_tokens',
      'full_misses', 'full_miss_tokens', 'wasted_usd']) cur[k] += p[k];
    cur.idle_gaps_sec.push(...p.idle_gaps_sec);
    byCommand.set(p.command, cur);
  }
  const rows = [...byCommand.values()].sort((a, b) => b.wasted_usd - a.wasted_usd);
  const M = (n) => `${(n / 1e6).toFixed(2)}M`;
  const w = Math.max(14, ...rows.map((r) => r.command.length + 2));
  const out = ['', 'WHY — cache accounting', '-'.repeat(w + 52),
    `${pad('phase', w)}${pad('cache rd', 10, true)}${pad('cache wr', 10, true)}`
    + `${pad('misses', 8, true)}${pad('rewrote', 10, true)}${pad('wasted', 10, true)}`];
  let wasted = 0; let misses = 0;
  const gaps = [];
  for (const r of rows) {
    wasted += r.wasted_usd; misses += r.full_misses; gaps.push(...r.idle_gaps_sec);
    out.push(pad(r.command === FREEFORM ? r.command : `/${r.command}`, w)
      + pad(M(r.cache_read_tokens), 10, true) + pad(M(r.cache_write_tokens), 10, true)
      + pad(r.full_misses, 8, true) + pad(M(r.full_miss_tokens), 10, true)
      + pad(`$${r.wasted_usd.toFixed(2)}`, 10, true));
  }
  out.push('-'.repeat(w + 52));
  out.push(`${misses} mid-session cache expiry/expiries rewrote whole contexts — $${wasted.toFixed(2)} avoidable.`);
  if (gaps.length) {
    out.push(`Idle seconds before each: ${gaps.sort((a, b) => a - b).join(', ')}`);
    out.push('Every gap above 300s outlived the 5-minute cache TTL. Subagent contexts are');
    out.push('written at that TTL only, so a long install or test run inside an agent');
    out.push('re-bills its entire context at 1.25x base on the next turn.');
  }
  return `${out.join('\n')}\n`;
}

// The batching half of "why". A turn that calls one tool pays the same full
// context re-read as a turn that calls five, so calls-per-turn is the lever and
// the single-call share is how much of it is unclaimed. Measured over the
// sprint-1 baseline: 695 of 835 turns issued exactly one call at ~116K resident
// context each — 96.6M tokens re-read for 1029 tool calls.
function renderBatching(profiles) {
  const by = new Map();
  for (const p of profiles) {
    const cur = by.get(p.command) || { command: p.command, all_turns: 0, tool_calls: 0, single_call_turns: 0, all_ctx_total: 0 };
    for (const k of ['all_turns', 'tool_calls', 'single_call_turns', 'all_ctx_total']) cur[k] += p[k] || 0;
    by.set(p.command, cur);
  }
  const rows = [...by.values()].filter((r) => r.all_turns > 0).sort((a, b) => b.all_ctx_total - a.all_ctx_total);
  if (rows.length === 0) return '';
  const w = Math.max(14, ...rows.map((r) => r.command.length + 2));
  const out = ['', 'WHY — turn batching', '-'.repeat(w + 52),
    `${pad('phase', w)}${pad('turns', 8, true)}${pad('calls', 8, true)}${pad('per turn', 10, true)}`
    + `${pad('1-call', 9, true)}${pad('ctx re-read', 13, true)}`];
  let turns = 0; let calls = 0; let single = 0; let ctx = 0;
  for (const r of rows) {
    turns += r.all_turns; calls += r.tool_calls; single += r.single_call_turns; ctx += r.all_ctx_total;
    out.push(pad(r.command === FREEFORM ? r.command : `/${r.command}`, w)
      + pad(r.all_turns, 8, true) + pad(r.tool_calls, 8, true)
      + pad(r.all_turns ? (r.tool_calls / r.all_turns).toFixed(2) : '0', 10, true)
      + pad(`${Math.round((r.single_call_turns / r.all_turns) * 100)}%`, 9, true)
      + pad(`${(r.all_ctx_total / 1e6).toFixed(1)}M`, 13, true));
  }
  out.push('-'.repeat(w + 52));
  out.push(`${single} of ${turns} turns (${Math.round((single / turns) * 100)}%) issued exactly ONE tool call, `
    + `at ${Math.round(ctx / turns / 1000)}K resident context each. `
    + `${(ctx / 1e6).toFixed(1)}M tokens re-read for ${calls} tool calls.`);
  out.push('Every one paid a full context re-read for a single call. Independent calls');
  out.push(`issued together would do the same ${calls} calls in far fewer turns.`);
  return `${out.join('\n')}\n`;
}

function main(argv) {
  const opts = parseCli(argv);
  const asJson = opts.json;
  const target = opts.target;
  if (opts.write) {
    const persist = require('../hooks/lib/phase-cost-persist');
    let transcriptPath = null;
    try {
      if (fs.statSync(target).isFile()) transcriptPath = path.resolve(target);
    } catch (_) { /* directory or missing — discover from project slug */ }
    const written = persist.writeSnapshot(process.cwd(), {
      transcriptPath,
      step: opts.step,
      event: opts.step ? 'step' : 'snapshot',
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify(written, null, 2)}\n`);
      return;
    }
  }
  const files = transcriptsFor(target);
  if (!files.length) {
    if (opts.write) return;
    process.stderr.write(`phase-cost: no transcripts found for ${target}\n`);
    process.exit(1);
  }
  const coverage = { subagentFiles: 0, sessions: files.length };
  const rows = files.flatMap((file) => {
    const extraTranscripts = subagentTranscriptsFor(file);
    coverage.subagentFiles += extraTranscripts.length;
    return costByPhase(file, { extraTranscripts });
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (!rows.length) {
    if (opts.write) return;
    process.stderr.write('phase-cost: transcripts found, but no slash-command phases in them\n');
    process.exit(1);
  }
  const profiles = opts.why
    ? files.flatMap((file) => cacheProfile(file, { extraTranscripts: subagentTranscriptsFor(file) }))
    : null;
  const shapes = opts.why
    ? files.flatMap((file) => turnProfile(file, { extraTranscripts: subagentTranscriptsFor(file) }))
    : null;
  const replacer = (_key, value) => (value instanceof Set ? [...value] : value);
  process.stdout.write(asJson
    ? JSON.stringify({
      rows, totals: aggregate(rows), coverage,
      ...(profiles ? { cache: profiles, turns: shapes } : {}),
    }, replacer, 2) + '\n'
    : render(rows, coverage) + (profiles ? renderWhy(profiles) + renderBatching(shapes) : ''));
}


// Core attribution is re-exported so existing consumers keep one import site.
module.exports = {
  segmentsFromTranscript, costByPhase, commandOf, aggregate,
  subagentTranscriptsFor, transcriptsFor, unpricedNote,
};

if (require.main === module) main(process.argv.slice(2));
