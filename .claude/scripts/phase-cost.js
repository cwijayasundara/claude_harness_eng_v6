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
  subagentTranscriptsFor, transcriptsFor, FREEFORM,
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
  const opts = { json: false, write: false, step: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--write') opts.write = true;
    else if (a === '--step') opts.step = argv[++i] || null;
    else if (!a.startsWith('--') && !opts.target) opts.target = a;
  }
  opts.target = opts.target || process.cwd();
  return opts;
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
  const replacer = (_key, value) => (value instanceof Set ? [...value] : value);
  process.stdout.write(asJson
    ? JSON.stringify({ rows, totals: aggregate(rows), coverage }, replacer, 2) + '\n'
    : render(rows, coverage));
}


// Core attribution is re-exported so existing consumers keep one import site.
module.exports = {
  segmentsFromTranscript, costByPhase, commandOf, aggregate,
  subagentTranscriptsFor, transcriptsFor, unpricedNote,
};

if (require.main === module) main(process.argv.slice(2));
