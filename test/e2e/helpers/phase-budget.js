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
  costByPhase, aggregate, transcriptsFor, subagentTranscriptsFor,
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
  let subagentFiles = 0;
  for (const transcript of transcripts) {
    const extras = subagentTranscriptsFor(transcript);
    subagentFiles += extras.length;
    rows.push(...costByPhase(transcript, { extraTranscripts: extras }));
  }

  // aggregate() returns a Set for models; a receipt has to serialise.
  const phases = aggregate(rows).map((r) => ({ ...r, models: [...r.models].sort() }));
  return {
    phases,
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
  };
}

function writeBaseline(routeId, bill, dir = BASELINE_DIR) {
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

  return {
    status: regressions.length ? 'regressed' : 'pass',
    tolerance, current, regressions, unratcheted,
  };
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
