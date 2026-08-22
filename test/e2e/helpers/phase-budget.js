'use strict';

// Per-phase token + cost assertions for the live e2e routes.
//
// The live routes spend real money and already record which sessions they ran,
// but none of them ever billed those sessions: a route could double its token
// cost and still pass green. `phase-cost-core` already attributes spend per
// slash command out of the transcript (main loop plus pooled subagent
// transcripts), so the reading was always available — this is the seam that
// turns it into an assertion.
//
// A ratchet, not a ceiling. Absolute cost moves with every model and prompt
// change, so a fixed cap gets bumped rather than investigated. A committed
// baseline plus a tolerance band fails only when a phase actually regresses.
//
// Vacuity is the failure mode this file guards hardest: a budget check over an
// empty bill passes every assertion trivially. `assertWithinBaseline` refuses
// to pass when no transcript was found.

const fs = require('fs');
const path = require('path');

const {
  costByPhase, aggregate, transcriptsFor, subagentTranscriptsFor, cacheProfile, turnProfile,
} = require('../../../.claude/hooks/lib/phase-cost-core.js');

const E2E_DIR = path.join(__dirname, '..');
const BASELINE_DIR = path.join(E2E_DIR, 'baselines');
const RECEIPT_DIR = path.join(E2E_DIR, 'results', 'cost');

// Below these a phase is noise: normal turn-level variance swamps the band and
// the ratchet would flake. Reported as unratcheted rather than silently passed.
const MIN_RATCHET_TOKENS = 5000;
const MIN_RATCHET_USD = 0.25;
const DEFAULT_TOLERANCE = 0.3;

/**
 * Bill one route.
 *
 * `target` is a project dir (all its sessions), a single transcript path, or an
 * array of either — the same contract `transcriptsFor` accepts, widened to a
 * list. `sessionIds` narrows a project dir to the sessions this route actually
 * created, so a leftover transcript from an earlier run in the same workdir
 * cannot be billed to this one.
 */
function billRoute(target, opts = {}) {
  const wanted = opts.sessionIds && opts.sessionIds.length ? new Set(opts.sessionIds) : null;
  const targets = Array.isArray(target) ? target : [target];
  const transcripts = [...new Set(targets.flatMap((t) => transcriptsFor(t)))]
    .filter((p) => !wanted || wanted.has(path.basename(p, '.jsonl')));

  const rows = [];
  const cacheRows = [];
  const shapeRows = [];
  let subagentFiles = 0;
  for (const transcript of transcripts) {
    const extras = subagentTranscriptsFor(transcript);
    subagentFiles += extras.length;
    rows.push(...costByPhase(transcript, { extraTranscripts: extras }));
    cacheRows.push(...cacheProfile(transcript, { extraTranscripts: extras }));
    shapeRows.push(...turnProfile(transcript, { extraTranscripts: extras }));
  }

  // aggregate() returns a Set for models; a receipt has to serialise.
  const phases = aggregate(rows).map((r) => ({ ...r, models: [...r.models].sort() }));
  return {
    phases,
    cache: cacheTotals(cacheRows),
    batching: batchingTotals(shapeRows),
    totals: totalsOf(phases),
    coverage: {
      sessions: transcripts.length,
      subagentFiles,
      // A bill with no subagent transcripts is main-loop only and undercounts
      // every phase that spawned agents — the same honesty note phase-cost.js
      // prints, carried into the receipt so a low number is not read as a win.
      mainLoopOnly: subagentFiles === 0,
      requestedSessions: wanted ? wanted.size : null,
    },
  };
}

/**
 * Cache accounting for the route: how much of the bill was context re-reads,
 * and how much was a whole context re-written after a cache expiry.
 *
 * Measured on the run this ratchet was built around, output was $2.70 of
 * $47.97 — so a token budget that watches only output tokens is watching 6% of
 * the spend. `wasted_usd` is the part that is avoidable rather than inherent.
 */
function cacheTotals(cacheRows) {
  const sum = (key) => cacheRows.reduce((acc, r) => acc + (r[key] || 0), 0);
  return {
    cache_read_tokens: sum('cache_read_tokens'),
    cache_write_tokens: sum('cache_write_tokens'),
    ttl_5m_tokens: sum('ttl_5m_tokens'),
    ttl_1h_tokens: sum('ttl_1h_tokens'),
    full_misses: sum('full_misses'),
    full_miss_tokens: sum('full_miss_tokens'),
    wasted_usd: Number(sum('wasted_usd').toFixed(4)),
    idle_gaps_sec: cacheRows.flatMap((r) => r.idle_gaps_sec || []).sort((a, b) => a - b),
  };
}

/**
 * Turn density for the route: how many turns did the work take, and how many
 * tool calls did each carry.
 *
 * The largest cost driver measured on this harness is not what a turn does but
 * how many turns there are — 695 of 833 turns in the sprint-1 baseline issued
 * exactly ONE tool call at ~116K resident context each, 96.6M tokens re-read
 * for 1029 calls. Cost and wall clock both fall with the turn count, so the
 * ratchet has to watch it directly: a prompt change that quietly stops agents
 * batching would otherwise show up only as a cost regression nobody can explain.
 */
function batchingTotals(shapeRows) {
  const sum = (key) => shapeRows.reduce((acc, r) => acc + (r[key] || 0), 0);
  const turns = sum('all_turns');
  const calls = sum('tool_calls');
  const single = sum('single_call_turns');
  return {
    all_turns: turns,
    tool_calls: calls,
    calls_per_turn: turns ? Number((calls / turns).toFixed(3)) : 0,
    single_call_turns: single,
    single_call_pct: turns ? Math.round((single / turns) * 100) : 0,
    ctx_re_read_tokens: sum('all_ctx_total'),
  };
}

function totalsOf(phases) {
  const sum = (key) => phases.reduce((acc, p) => acc + (p[key] || 0), 0);
  return {
    output_tokens: sum('output_tokens'),
    subagent_output_tokens: sum('subagent_output_tokens'),
    cache_read_tokens: sum('cache_read_tokens'),
    cost_usd: Number(sum('cost_usd').toFixed(4)),
  };
}

/** Output tokens a phase is responsible for, main loop plus its subagents. */
function outputTotal(phase) {
  return (phase.output_tokens || 0) + (phase.subagent_output_tokens || 0);
}

// `dir` exists so the IO layer can be exercised against a scratch directory;
// every caller in the routes uses the committed default.
function baselinePath(routeId, dir = BASELINE_DIR) {
  return path.join(dir, `${routeId}.json`);
}

function receiptFor(routeId) {
  return path.join(RECEIPT_DIR, `${routeId}.json`);
}

function writeReceipt(routeId, bill) {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  const file = receiptFor(routeId);
  fs.writeFileSync(file, `${JSON.stringify(bill, null, 2)}\n`);
  return file;
}

/** The comparable shape: what a baseline stores and what a run is checked against. */
function baselineFrom(bill) {
  const phases = {};
  for (const p of bill.phases) {
    phases[p.command] = {
      runs: p.runs,
      output_total: outputTotal(p),
      cost_usd: Number(p.cost_usd.toFixed(4)),
    };
  }
  return {
    phases,
    total: {
      output_total: bill.totals.output_tokens + bill.totals.subagent_output_tokens,
      cost_usd: bill.totals.cost_usd,
    },
    batching: bill.batching,
  };
}

/**
 * Record a baseline, refusing one that covers less than the route ran.
 *
 * How the committed sprint-1 baseline came to be wrong: it was recorded from a
 * RESUMED run, where an already-settled phase returned early without recording
 * its session id, so the bill narrowed to whatever that last process executed.
 * The result claimed $43.88 across four phases when the run really cost $47.97
 * across seven — /scaffold and /brd were absent entirely and (freeform) was
 * recorded at $0.00 across six runs. A baseline that silently omits phases does
 * not merely understate: the ratchet then stops watching those phases forever,
 * which is strictly worse than having no baseline at all.
 *
 * `expectPhases` is the guard. A phase billed at exactly zero is treated as
 * absent too — six runs costing $0.00 is not a measurement.
 */
function writeBaseline(routeId, bill, dir = BASELINE_DIR, opts = {}) {
  const expect = opts.expectPhases || [];
  const billed = new Set(bill.phases.filter((p) => p.cost_usd > 0).map((p) => p.command));
  const missing = expect.filter((name) => !billed.has(name));
  if (missing.length) {
    throw new Error(
      `phase-budget: refusing to record a "${routeId}" baseline missing ${missing.map((m) => `/${m}`).join(', ')}. `
      + `Billed: ${[...billed].map((b) => `/${b}`).join(', ') || '(nothing)'}. `
      + 'A baseline recorded from a partial run makes the ratchet permanently blind to the phases it omits. '
      + 'If this was a resumed run, the skipped phases never recorded their session ids.',
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = baselinePath(routeId, dir);
  fs.writeFileSync(file, `${JSON.stringify(baselineFrom(bill), null, 2)}\n`);
  return file;
}

function readBaseline(routeId, dir = BASELINE_DIR) {
  try { return JSON.parse(fs.readFileSync(baselinePath(routeId, dir), 'utf8')); }
  catch (_) { return null; }
}

/**
 * Compare a bill against the committed baseline.
 *
 * Returns a verdict; the caller asserts on `status`. Throws only for a bill
 * that cannot mean anything (no transcript) — a run that produced no
 * measurable spend must not read as a run that came in under budget.
 *
 * `opts.baseline` supplies the comparison directly; without it the committed
 * baseline is read from disk. The comparison itself does no IO.
 */
function checkBudget(routeId, bill, opts = {}) {
  const tolerance = opts.tolerance == null ? DEFAULT_TOLERANCE : opts.tolerance;
  if (bill.coverage.sessions === 0) {
    throw new Error(
      `phase-budget: no transcript found for route "${routeId}" — refusing to pass a budget `
      + 'check over an empty bill. Was the run made from a different cwd, or the session id lost?',
    );
  }

  const current = baselineFrom(bill);
  if (opts.update) {
    return { status: 'recorded', reason: 'update requested', current, regressions: [], unratcheted: [] };
  }
  const baseline = opts.baseline || readBaseline(routeId);
  if (!baseline) {
    return { status: 'recorded', reason: 'no baseline on disk', current, regressions: [], unratcheted: [] };
  }

  const regressions = [];
  const unratcheted = [];

  // A phase the baseline knows about that produced no bill at all is not
  // "under budget" — it is a phase that did not run, or whose sessions were
  // lost. The loop below skips any phase absent from either side, so without
  // this check a route that crashed after /brd would pass its budget check
  // green. Reported as a `missing` regression so it fails loudly.
  for (const name of Object.keys((baseline && baseline.phases) || {})) {
    if (!(current.phases || {})[name]) {
      regressions.push({
        label: `/${name}`, metric: 'coverage', before: baseline.phases[name].cost_usd, after: 0,
        reason: 'phase present in the baseline produced no bill in this run — it did not run, '
          + 'or its session id was not recorded. An absent phase is not an under-budget phase.',
      });
    }
  }

  const entries = [
    ...Object.keys(baseline.phases || {}).map((k) => [`/${k}`, baseline.phases[k], (current.phases || {})[k]]),
    ['TOTAL', baseline.total, current.total],
  ];

  for (const [label, base, now] of entries) {
    if (!base || !now) continue; // a phase absent from either side is not a budget fact
    for (const [metric, floor] of [['output_total', MIN_RATCHET_TOKENS], ['cost_usd', MIN_RATCHET_USD]]) {
      const before = base[metric] || 0;
      const after = now[metric] || 0;
      if (before < floor) { unratcheted.push({ label, metric, before, after, reason: 'below floor' }); continue; }
      const limit = before * (1 + tolerance);
      if (after > limit) {
        regressions.push({
          label, metric, before, after,
          limit: Number(limit.toFixed(4)),
          overBy: `${Math.round(((after / before) - 1) * 100)}%`,
        });
      }
    }
  }

  regressions.push(...batchingRegressions(baseline.batching, current.batching, tolerance));

  return {
    status: regressions.length ? 'regressed' : 'pass',
    tolerance, current, regressions, unratcheted,
  };
}

/**
 * Efficiency regressions, which move in the opposite direction to cost.
 *
 * `ctx_re_read_tokens` is the direct driver of the cache-read bill, so a RISE
 * is the regression. `calls_per_turn` is the lever that produces it, so a FALL
 * is the regression — a prompt change that quietly stops agents batching shows
 * up here as itself rather than as an unexplained cost increase two phases
 * downstream. Both are skipped when the baseline predates the measurement.
 */
function batchingRegressions(base, now, tolerance) {
  if (!base || !now || !base.all_turns) return [];
  const out = [];
  const ctxLimit = (base.ctx_re_read_tokens || 0) * (1 + tolerance);
  if (base.ctx_re_read_tokens && now.ctx_re_read_tokens > ctxLimit) {
    out.push({
      label: 'BATCHING', metric: 'ctx_re_read_tokens',
      before: base.ctx_re_read_tokens, after: now.ctx_re_read_tokens,
      limit: Math.round(ctxLimit),
      overBy: `${Math.round(((now.ctx_re_read_tokens / base.ctx_re_read_tokens) - 1) * 100)}%`,
    });
  }
  const callsFloor = (base.calls_per_turn || 0) * (1 - tolerance);
  if (base.calls_per_turn && now.calls_per_turn < callsFloor) {
    out.push({
      label: 'BATCHING', metric: 'calls_per_turn',
      before: base.calls_per_turn, after: now.calls_per_turn,
      limit: Number(callsFloor.toFixed(3)),
      reason: 'agents stopped batching independent tool calls — every turn re-reads the '
        + 'whole context, so this drives the cache-read bill and the wall clock together',
    });
  }
  return out;
}

/** One line per phase, for the route's own console output. */
function formatBill(routeId, bill) {
  const lines = [`[${routeId}] phase bill (${bill.coverage.sessions} session(s), ${bill.coverage.subagentFiles} subagent transcript(s))`];
  for (const p of bill.phases) {
    lines.push(
      `  ${(p.command === 'freeform' ? '(freeform)' : `/${p.command}`).padEnd(22)}`
      + `${String(p.runs).padStart(3)} run  `
      + `${outputTotal(p).toLocaleString().padStart(10)} out tok  `
      + `$${p.cost_usd.toFixed(2).padStart(8)}`,
    );
  }
  lines.push(`  ${'TOTAL'.padEnd(22)}${''.padStart(3)}      `
    + `${(bill.totals.output_tokens + bill.totals.subagent_output_tokens).toLocaleString().padStart(10)} out tok  `
    + `$${bill.totals.cost_usd.toFixed(2).padStart(8)}`);
  const b = bill.batching;
  if (b && b.all_turns) {
    lines.push(`  ${'turns'.padEnd(22)}${String(b.all_turns).padStart(3)}      `
      + `${b.tool_calls.toLocaleString().padStart(10)} calls   `
      + `${b.calls_per_turn.toFixed(2)}/turn  ${b.single_call_pct}% single-call  `
      + `${(b.ctx_re_read_tokens / 1e6).toFixed(1)}M re-read`);
  }
  if (bill.coverage.mainLoopOnly) {
    lines.push('  NOTE: no subagent transcripts pooled — figures are MAIN-LOOP ONLY and undercount.');
  }
  return lines.join('\n');
}

module.exports = {
  billRoute, checkBudget, writeBaseline, writeReceipt, readBaseline, formatBill,
  baselinePath, receiptFor, outputTotal,
  DEFAULT_TOLERANCE, MIN_RATCHET_TOKENS, MIN_RATCHET_USD,
};
