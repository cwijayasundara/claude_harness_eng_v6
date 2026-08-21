'use strict';

// Per-phase token + cost attribution: reading a transcript and turning it into
// per-command rows. Extracted from phase-cost.js so the CLI and the persist lib
// can each require it directly.
//
// The two used to require EACH OTHER: the CLI pulled in phase-cost-persist.js
// from inside main(), and that lib required phase-cost.js straight back. It
// worked only while phase-cost.js assigned module.exports before its
// `require.main` entry line — reversed, --write got an empty exports object and
// died, invisibly to any in-process test. That invariant was policed by a
// comment in two files. With the shared half here, there is no cycle to police.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { usageFromTranscripts, loadTurns } = require('./transcript-usage.js');

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

/**
 * Per-phase turn shape: how big the context was on each turn, and how much of
 * the phase was pure conversation.
 *
 * costByPhase answers "what did this phase cost". It cannot answer "why", and on
 * this harness the why is nearly always the same two things: cache reads are
 * ~5x output, so cost is turns x resident context, and a phase that grows its
 * context as it runs pays that growth on every remaining turn. A measured /spec
 * opened at 56K and closed at 120K across 59 turns — 35 of which called no tool
 * at all, each re-reading ~93K to ask or answer a question.
 *
 * Neither number is visible in a cost table, so the lever stays invisible too.
 */
function turnProfile(transcriptPath, opts = {}) {
  const extras = (opts.extraTranscripts || []).map((p) => ({ path: p, subagent: true }));
  const sources = [transcriptPath, ...extras];
  const segments = segmentsFromTranscript(transcriptPath);
  const { turns } = loadTurns(sources);
  return segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    const mine = turns
      .filter((t) => !t.sidechain && t.ts != null && t.ts >= seg.start && (isLast || t.ts < seg.end))
      .sort((a, b) => a.ts - b.ts);
    const seen = new Set();
    const unique = mine.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
    return { command: seg.command, start: new Date(seg.start).toISOString(), ...shapeOf(unique) };
  });
}

/** Context-per-turn statistics for one phase's turns, in order. */
function shapeOf(turns) {
  const ctx = turns.map((t) => (t.usage.cache_read_input_tokens || 0)
    + (t.usage.cache_creation_input_tokens || 0)
    + (t.usage.input_tokens || 0));
  if (ctx.length === 0) {
    return { turns: 0, ctx_first: 0, ctx_median: 0, ctx_last: 0, ctx_total: 0, growth: 0, toolless: 0, toolless_pct: 0 };
  }
  const sorted = [...ctx].sort((a, b) => a - b);
  const first = ctx[0];
  const last = ctx[ctx.length - 1];
  const toolless = turns.filter((t) => (t.tools || 0) === 0).length;
  return {
    turns: ctx.length,
    ctx_first: first,
    ctx_median: sorted[Math.floor(sorted.length / 2)],
    ctx_last: last,
    ctx_total: ctx.reduce((a, b) => a + b, 0),
    growth: first > 0 ? Number((last / first).toFixed(2)) : 0,
    toolless,
    toolless_pct: Math.round((toolless / ctx.length) * 100),
  };
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

module.exports = {
  turnProfile,
  segmentsFromTranscript, costByPhase, commandOf, aggregate,
  subagentTranscriptsFor, transcriptsFor,
  // Shared vocabulary: the core emits this command name for turns before any
  // slash command, and the renderer compares against it.
  FREEFORM,
};
