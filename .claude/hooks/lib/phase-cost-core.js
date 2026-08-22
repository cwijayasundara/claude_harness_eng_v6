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
const {
  usageFromTranscripts, loadTurns, mergeTurnsById, priceOf,
} = require('./transcript-usage.js');

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
 * this harness the why is turns x resident context: cache reads were $27.88 of
 * a $47.97 run against $2.70 of output.
 *
 * Three numbers separate the ways a phase gets expensive, and none is visible
 * in a cost table:
 *
 *  - GROWTH — a phase that grows its context pays that growth on every
 *    remaining turn (ctx_first -> ctx_last).
 *  - CONVERSATION — turns that called no tool at all, each re-reading the whole
 *    context to ask or answer a question (toolless_pct).
 *  - BATCHING — turns that called exactly ONE tool. This is the big one and it
 *    was invisible until the block-line bug below was fixed: over the sprint-1
 *    baseline, 695 of 835 turns issued a single tool call at ~116K resident
 *    context each. Batching independent calls is the difference between 835
 *    turns and ~372 for the same work.
 *
 * MAIN-LOOP vs SUBAGENT. The ctx_* curve covers main-loop turns only, because a
 * pooled curve across agents with separate context spaces means nothing. But
 * reporting ONLY those made /auto read as "5 turns, 100% toolless" when its
 * real cost was 576 turns of near-continuous tool use in subagents — so the
 * subagent population is counted too, in its own fields, and the batching
 * statistics span both.
 */
function turnProfile(transcriptPath, opts = {}) {
  const extras = (opts.extraTranscripts || []).map((p) => ({ path: p, subagent: true }));
  const sources = [transcriptPath, ...extras];
  const segments = segmentsFromTranscript(transcriptPath);
  const { turns } = loadTurns(sources);
  return segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    const inSeg = (t) => t.ts != null && t.ts >= seg.start && (isLast || t.ts < seg.end);
    const all = mergeTurnsById(turns.filter(inSeg)).sort((a, b) => a.ts - b.ts);
    const main = all.filter((t) => !t.sidechain);
    const sub = all.filter((t) => t.sidechain);
    return {
      command: seg.command,
      start: new Date(seg.start).toISOString(),
      ...shapeOf(main),
      ...batchingOf(all, sub),
    };
  });
}

/**
 * Tool-call density across every turn the phase caused, subagents included.
 * A turn that calls one tool pays the same full context re-read as a turn that
 * calls five, so `calls_per_turn` is the lever and `single_call_pct` is how
 * much of it is unclaimed.
 */
function batchingOf(all, sub) {
  const calls = all.reduce((n, t) => n + (t.tools || 0), 0);
  const single = all.filter((t) => (t.tools || 0) === 1).length;
  return {
    all_turns: all.length,
    subagent_turns: sub.length,
    tool_calls: calls,
    calls_per_turn: all.length ? Number((calls / all.length).toFixed(2)) : 0,
    single_call_turns: single,
    single_call_pct: all.length ? Math.round((single / all.length) * 100) : 0,
    // Context re-read across EVERY turn the phase caused. ctx_total above is
    // main-loop only, which for /auto is 5 turns of a 574-turn phase — reporting
    // that as the phase's re-read understated it by more than 100x.
    all_ctx_total: all.reduce((n, t) => n + residentContext(t.usage), 0),
  };
}

/** Everything a request had to carry: cache read + cache creation + fresh input. */
function residentContext(usage) {
  return (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.input_tokens || 0);
}

/** Context-per-turn statistics for one phase's turns, in order. */
function shapeOf(turns) {
  const ctx = turns.map((t) => residentContext(t.usage));
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

/**
 * Why a phase cost what it did, in cache terms.
 *
 * On this harness the bill is not generation. Measured over the 2026-08-21
 * sprint-1 baseline: output was $2.70 of $47.97, cache READ $27.88 (58%) and
 * cache WRITE $17.38 (36%). Two levers hide behind those numbers and neither is
 * visible in a cost table:
 *
 *  - RESIDENT CONTEXT x TURNS drives the read half. turnProfile covers that.
 *  - CACHE MISSES drive an avoidable slice of the write half. Every cache block
 *    a subagent writes carries the 5-minute TTL (`ephemeral_1h` was 0.00M
 *    across every agent-*.jsonl in that run, while main-loop sessions did get
 *    1h on their static prefix). A subagent that idles past 5 minutes — a
 *    `uv sync`, an install, a test suite — re-writes its WHOLE context at
 *    1.25x base. 18 such turns rewrote 1.98M tokens, $7.42 of the run, and the
 *    idle gap before every one of them exceeded the TTL (shortest 8.2 min).
 *
 * A session's FIRST turn also reads nothing, but that is a legitimate cold
 * start, not waste — hence the per-source grouping. Counting it would report
 * every run as having one unavoidable "miss" per agent and make the real signal
 * unreadable.
 *
 * `wasted_usd` is the DIFFERENCE between what the rewrite cost and what a hit
 * would have cost, not the gross write — the context had to be paid for once
 * either way.
 */
function cacheProfile(transcriptPath, opts = {}) {
  const extras = (opts.extraTranscripts || []).map((p) => ({ path: p, subagent: true }));
  const sources = [transcriptPath, ...extras];
  const segments = segmentsFromTranscript(transcriptPath);
  const { turns } = loadTurns(sources);

  // A rewrite below this is an ordinary incremental append, not an expiry.
  const MISS_FLOOR = opts.missFloor || 20000;

  const seen = new Set();
  const unique = turns.filter((t) => (t.id && seen.has(t.id) ? false : (t.id && seen.add(t.id), true)));
  const firstOf = new Map();
  for (const t of [...unique].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    if (t.source && !firstOf.has(t.source)) firstOf.set(t.source, t.id);
  }

  // Last turn timestamp per source, carried ACROSS segments: a phase's FIRST
  // miss is preceded by a turn in the previous phase, and a per-segment map
  // made that gap invisible — which is exactly the gap that explains the miss.
  const prevTs = new Map();

  return segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    const mine = unique
      .filter((t) => t.ts != null && t.ts >= seg.start && (isLast || t.ts < seg.end))
      .sort((a, b) => a.ts - b.ts);

    let cacheRead = 0; let cacheWrite = 0; let ttl5 = 0; let ttl1h = 0;
    let missCount = 0; let missTokens = 0; let wasted = 0;
    const gapsSec = [];

    for (const t of mine) {
      const u = t.usage;
      const cr = u.cache_read_input_tokens || u.cache_read_tokens || 0;
      const cw = u.cache_creation_input_tokens || u.cache_creation_tokens || 0;
      cacheRead += cr; cacheWrite += cw;
      const cc = u.cache_creation || {};
      ttl5 += cc.ephemeral_5m_input_tokens || 0;
      ttl1h += cc.ephemeral_1h_input_tokens || 0;

      const coldStart = firstOf.get(t.source) === t.id;
      if (!coldStart && cr === 0 && cw >= MISS_FLOOR) {
        missCount += 1;
        missTokens += cw;
        wasted += priceOf({ cache_creation_tokens: cw, cache_read_tokens: 0 }, t.model)
          - priceOf({ cache_read_tokens: cw }, t.model);
        const before = prevTs.get(t.source);
        if (before != null) gapsSec.push(Math.round((t.ts - before) / 1000));
      }
      if (t.ts != null) prevTs.set(t.source, t.ts);
    }

    return {
      command: seg.command,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      ttl_5m_tokens: ttl5,
      ttl_1h_tokens: ttl1h,
      full_misses: missCount,
      full_miss_tokens: missTokens,
      wasted_usd: Number(wasted.toFixed(4)),
      idle_gaps_sec: gapsSec.sort((a, b) => a - b),
    };
  });
}

module.exports = {
  turnProfile, cacheProfile,
  segmentsFromTranscript, costByPhase, commandOf, aggregate,
  subagentTranscriptsFor, transcriptsFor,
  // Shared vocabulary: the core emits this command name for turns before any
  // slash command, and the renderer compares against it.
  FREEFORM,
};
