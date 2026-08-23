'use strict';

// Turn-shape and cache profiling over a transcript: how many turns a phase
// took, how much context each one carried, how many tool calls it batched, and
// how much of the bill was a cache rewrite that a hit would have covered.
//
// Split out of phase-cost-core.js, which had grown to 405 lines against a 300
// cap. The seam is real rather than arithmetic: the core answers "what did each
// phase cost", this answers "what shape were the turns that cost it". The core
// does not depend on these, so the dependency runs one way.

const path = require('path');
const { loadTurns, mergeTurnsById, priceOf } = require('./transcript-usage.js');
const { segmentsFromTranscript } = require('./phase-cost-core.js');

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

module.exports = { turnProfile, cacheProfile, shapeOf, residentContext, batchingOf };
