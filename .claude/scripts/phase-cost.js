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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { usageFromTranscripts, loadTurns } = require('../hooks/lib/transcript-usage.js');

const COMMAND_TAG = /<command-name>\s*([^<]+?)\s*<\/command-name>/;
const LEADING_SLASH = /^\/([A-Za-z0-9_:-]+)/;
const FREEFORM = '(freeform)';

// Claude Code's own CLI commands. They do no phase work, but each one used to
// open a segment that ran until the next command — which is how /clear and
// /model came to absorb $936 of unrelated conversation on a live transcript.
// Harness skills that share a name with nothing here (/context, /status) are
// deliberately absent so they still register as phases.
const BUILTIN_COMMANDS = new Set([
  'clear', 'compact', 'model', 'agents', 'login', 'logout', 'config', 'help',
  'exit', 'quit', 'doctor', 'cost', 'resume', 'effort', 'memory', 'permissions',
  'hooks', 'mcp', 'ide', 'upgrade', 'release-notes', 'add-dir', 'statusline',
  'export', 'todos', 'output-style', 'install-github-app', 'keybindings', 'bug',
  'feedback', 'privacy-settings', 'terminal-setup', 'vim', 'usage', 'plugin',
]);

function textOf(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.text) || '').join(' ');
  return '';
}

// A user turn -> the bare command name it invokes, or null. Plugin scoping
// (`plugin:command`) is stripped so `/design` and `plugin:design` aggregate.
function commandOf(text) {
  const raw = String(text || '').trim();
  const tagged = raw.match(COMMAND_TAG);
  const slashed = raw.match(LEADING_SLASH);
  const name = tagged ? tagged[1] : (slashed ? slashed[1] : null);
  if (!name) return null;
  const bare = name.replace(/^\//, '').split(':').pop();
  return bare ? bare.toLowerCase() : null;
}

function readRows(transcriptPath) {
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return null;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (_) { /* truncated or partial line */ }
  }
  return rows;
}

/**
 * Slash-command segments in a transcript, each spanning until the next command.
 * Sidechain (subagent) user turns never open a segment — a dispatched agent's
 * prompt is part of the phase that dispatched it, not a phase of its own.
 */
function segmentsFromTranscript(transcriptPath) {
  const rows = readRows(transcriptPath);
  if (!rows) return [];
  const marks = [];
  let lastTs = null;
  let firstTs = null;
  for (const row of rows) {
    const ts = row.timestamp ? Date.parse(row.timestamp) : null;
    if (ts != null && !Number.isNaN(ts)) {
      if (firstTs == null) firstTs = ts;
      lastTs = ts;
    }
    if (row.type !== 'user' || row.isSidechain === true) continue;
    const command = commandOf(textOf(row.message));
    if (command && !BUILTIN_COMMANDS.has(command) && ts != null) marks.push({ command, start: ts });
  }
  // Anything before the first real command is still spend; report it as
  // freeform rather than dropping it and understating the session.
  if (firstTs != null && (!marks.length || marks[0].start > firstTs)) {
    marks.unshift({ command: FREEFORM, start: firstTs });
  }
  return marks.map((mark, i) => ({
    command: mark.command,
    start: mark.start,
    end: i + 1 < marks.length ? marks[i + 1].start : (lastTs != null ? lastTs : mark.start),
  }));
}

/**
 * Segments joined with their measured usage. One row per invocation.
 *
 * `extraTranscripts` are subagent task transcripts pooled into whichever phase
 * window their timestamps fall in — a dispatched agent's spend belongs to the
 * phase that dispatched it. Without them the bill is main-loop only, which on
 * this harness is a large undercount, so the row carries the subagent share
 * explicitly rather than letting a partial number read as a total.
 */
function costByPhase(transcriptPath, opts = {}) {
  const extras = (opts.extraTranscripts || []).map((p) => ({ path: p, subagent: true }));
  const sources = [transcriptPath, ...extras];
  const segments = segmentsFromTranscript(transcriptPath);
  // Parse the corpus once; each segment only re-windows it in memory.
  const loaded = loadTurns(sources);
  return segments.map((seg, i) => {
    // The last phase runs until everything stops, not until the main loop's
    // final turn — a subagent it dispatched can still be working after that.
    const isLast = i === segments.length - 1;
    const window = { since: seg.start, until: isLast ? null : seg.end };
    const usage = usageFromTranscripts(sources, { ...window, loaded });
    return {
      command: seg.command,
      start: new Date(seg.start).toISOString(),
      minutes: Math.round((seg.end - seg.start) / 60000),
      model: usage.model,
      by_model: usage.by_model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      messages: usage.messages,
      subagent_output_tokens: usage.sidechain_output_tokens,
      subagent_messages: usage.sidechain_messages,
      cost_usd: usage.cost_usd,
      unpriced_models: usage.unpriced_models,
    };
  });
}

function projectSlug(projectDir) {
  return path.resolve(projectDir).replace(/[/_.]/g, '-');
}

function transcriptsFor(target) {
  const stat = (() => { try { return fs.statSync(target); } catch (_) { return null; } })();
  if (stat && stat.isFile()) return [target];
  const dir = path.join(os.homedir(), '.claude', 'projects', projectSlug(target || process.cwd()));
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

// Subagent transcripts for a session live in a sibling directory of the session
// transcript itself: <projects>/<slug>/<sessionUuid>/subagents/agent-*.jsonl.
//
// An earlier version searched /tmp/claude-<uid>/<slug>/<sessionUuid>/tasks/.
// That directory is keyed by a different runtime uuid, so it never matched a
// transcript filename and the whole feature was inert: a real session reported
// $92.71 against a true $173.25 (46% light) while printing a note blaming
// cleaned temp files. Resolve from the transcript path, which is always known.
function subagentTranscriptsFor(transcriptPath) {
  const session = path.basename(transcriptPath, '.jsonl');
  const dir = path.join(path.dirname(transcriptPath), session, 'subagents');
  try {
    // agent-*.jsonl only: the same trees can hold background-Bash logs, which
    // parse to zero turns but would inflate the coverage count and flip the
    // honesty note from "main-loop only" to a false "subagents pooled".
    return fs.readdirSync(dir)
      .filter((f) => /^agent-.*\.jsonl$/.test(f))
      .map((f) => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

function aggregate(rows) {
  const byCommand = new Map();
  for (const row of rows) {
    const cur = byCommand.get(row.command) || {
      command: row.command, runs: 0, minutes: 0, output_tokens: 0,
      cache_read_tokens: 0, subagent_output_tokens: 0, cost_usd: 0, models: new Set(),
    };
    cur.runs += 1;
    cur.minutes += row.minutes;
    cur.output_tokens += row.output_tokens;
    cur.cache_read_tokens += row.cache_read_tokens;
    cur.subagent_output_tokens += row.subagent_output_tokens || 0;
    cur.cost_usd += row.cost_usd;
    for (const m of Object.keys(row.by_model || {})) cur.models.add(m);
    byCommand.set(row.command, cur);
  }
  return [...byCommand.values()].sort((a, b) => b.cost_usd - a.cost_usd);
}

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

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const asJson = argv.includes('--json');
  const target = args[0] || process.cwd();
  const files = transcriptsFor(target);
  if (!files.length) {
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
    process.stderr.write('phase-cost: transcripts found, but no slash-command phases in them\n');
    process.exit(1);
  }
  const replacer = (_key, value) => (value instanceof Set ? [...value] : value);
  process.stdout.write(asJson
    ? JSON.stringify({ rows, totals: aggregate(rows), coverage }, replacer, 2) + '\n'
    : render(rows, coverage));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  segmentsFromTranscript, costByPhase, commandOf, aggregate, subagentTranscriptsFor, unpricedNote,
};
