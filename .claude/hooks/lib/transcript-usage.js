'use strict';

// Transcript-derived token usage.
//
// Claude Code hook payloads carry no token, cost, or model fields — the
// documented common fields are session_id, prompt_id, transcript_path, cwd,
// permission_mode, effort and hook_event_name. `transcript_path` is the only
// handle on real spend, so usage is read back out of the transcript JSONL.
//
// DEDUP IS LOAD-BEARING. One assistant message is written once per content
// block and every line repeats the same usage object; summing lines instead of
// messages inflated a real 1661-line transcript by ~68%.

const fs = require('fs');
const { MODEL_PRICE, CACHE_READ_FRACTION } = require('../../scripts/budget-state.js');

const SYNTHETIC_MODEL = '<synthetic>';

function emptyBucket() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    messages: 0,
  };
}

// One transcript line -> the usage-bearing assistant turn it represents, or null.
function parseTurn(line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch (_) {
    return null;
  }
  const message = row && row.message;
  const usage = message && message.usage;
  if (row.type !== 'assistant' || !usage) return null;
  // Claude Code emits <synthetic> turns (injected notices, errors). They are
  // not a billable model and must not be priced at the default rate.
  if (message.model === SYNTHETIC_MODEL) return null;
  const id = message.id || row.requestId;
  if (!id) return null;
  return {
    id,
    model: message.model || null,
    ts: row.timestamp ? Date.parse(row.timestamp) : null,
    sidechain: row.isSidechain === true,
    usage,
  };
}

function inWindow(turn, since, until) {
  if (since == null && until == null) return true;
  if (turn.ts == null || Number.isNaN(turn.ts)) return false;
  if (since != null && turn.ts < since) return false;
  if (until != null && turn.ts > until) return false;
  return true;
}

function addUsage(bucket, usage) {
  bucket.input_tokens += usage.input_tokens || 0;
  bucket.output_tokens += usage.output_tokens || 0;
  bucket.cache_read_tokens += usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
  bucket.cache_creation_tokens += usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
  bucket.messages += 1;
}

function priceOf(bucket, model) {
  const price = MODEL_PRICE[model] || MODEL_PRICE.default;
  return bucket.input_tokens * price[0]
    + bucket.output_tokens * price[1]
    + bucket.cache_read_tokens * price[0] * CACHE_READ_FRACTION
    + bucket.cache_creation_tokens * price[0];
}

// The model that produced the most output tokens — the honest label for a
// mixed-model window, rather than whichever turn happened to come first.
function dominantModel(byModel) {
  let best = null;
  for (const [model, bucket] of Object.entries(byModel)) {
    if (!best || bucket.output_tokens > byModel[best].output_tokens) best = model;
  }
  return best;
}

function readTurns(transcriptPath) {
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return null;
  }
  const turns = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const turn = parseTurn(line);
    if (turn) turns.push(turn);
  }
  return turns;
}

// Fold the selected turns into total / per-model / sidechain buckets, counting
// each message id exactly once.
function tally(turns, { since, until, includeSidechain }) {
  const total = emptyBucket();
  const byModel = {};
  const sidechain = emptyBucket();
  const seen = new Set();

  for (const turn of turns) {
    if (!includeSidechain && turn.sidechain) continue;
    if (!inWindow(turn, since, until)) continue;
    if (seen.has(turn.id)) continue;
    seen.add(turn.id);

    const model = turn.model || 'unknown';
    if (!byModel[model]) byModel[model] = emptyBucket();
    addUsage(byModel[model], turn.usage);
    addUsage(total, turn.usage);
    if (turn.sidechain) addUsage(sidechain, turn.usage);
  }
  return { total, byModel, sidechain };
}

/**
 * Aggregate token usage from a transcript JSONL.
 *
 * @param {string} transcriptPath
 * @param {object} [opts]
 * @param {number} [opts.since]  epoch ms, inclusive lower bound
 * @param {number} [opts.until]  epoch ms, inclusive upper bound
 * @param {boolean} [opts.includeSidechain=true] count subagent turns
 * @returns {object} totals + per-model breakdown + cost_usd (never throws)
 */
function usageFromTranscript(transcriptPath, opts = {}) {
  return usageFromTranscripts([transcriptPath], opts);
}

// Load one source into turns. A source is either a path, or {path, subagent}
// where `subagent: true` marks a task transcript whose turns are all subagent
// work even though the file itself carries no isSidechain flag.
function turnsFromSource(source) {
  const file = typeof source === 'string' ? source : source.path;
  const forced = typeof source === 'string' ? false : source.subagent === true;
  const turns = readTurns(file);
  if (!turns) return { turns: [], read: false };
  return { turns: forced ? turns.map((t) => ({ ...t, sidechain: true })) : turns, read: true };
}

/**
 * Aggregate usage across several transcripts as one pool, deduplicating by
 * message id across files. Same options and shape as usageFromTranscript.
 */
function usageFromTranscripts(sources, opts = {}) {
  const { since = null, until = null, includeSidechain = true } = opts;
  const pooled = [];
  let anyRead = false;
  for (const source of sources) {
    const { turns, read } = turnsFromSource(source);
    if (read) anyRead = true;
    pooled.push(...turns);
  }
  const { total, byModel, sidechain } = tally(pooled, { since, until, includeSidechain });

  let cost = 0;
  for (const [model, bucket] of Object.entries(byModel)) cost += priceOf(bucket, model);

  return {
    ...total,
    by_model: byModel,
    model: dominantModel(byModel),
    sidechain_output_tokens: sidechain.output_tokens,
    sidechain_messages: sidechain.messages,
    cost_usd: cost,
    read: anyRead,
  };
}

module.exports = { usageFromTranscript, usageFromTranscripts, parseTurn, priceOf };
