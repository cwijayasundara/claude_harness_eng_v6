#!/usr/bin/env node

'use strict';

// Phase-2 A/B comparison: does one build arm beat another on the article's bar —
// CHEAPER PER PASSED STORY AT EQUAL-OR-BETTER SCORE? Report-only, deterministic,
// exit 0 always. It changes nothing on its own; it turns a preset choice
// (e.g. balanced vs fusion) into an evidence-backed call.
//
// It CONSUMES the two upstream artifacts rather than reimplementing their math:
//   - <arm>/.claude/state/cost-per-outcome.json (cost-per-outcome.js): run_total
//     {est_cost_usd, passed, total, cost_per_passed_story} + tier.label.
//   - <arm>/specs/retro/loop-health.json (loop-health.js): signals.telemetry
//     {turns, subagents} -> turns-per-dispatch (divide-by-zero guarded).
//
// Honest guards travel with the report: a missing/unreadable artifact yields
// status "arm-missing" (naming the arm), and an arm that passed 0 stories yields
// an "inconclusive" verdict instead of a bogus winner.

const fs = require('fs');
const path = require('path');

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const armName = (a) => `${a.id} (${a.label})`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// turns / dispatches, or "n/a" when nothing was dispatched — never Infinity/NaN.
function turnsPerDispatch(turns, subagents) {
  return isNum(subagents) && subagents > 0 ? round2(turns / subagents) : 'n/a';
}

// B relative to A. Non-numeric on either side (e.g. "n/a") -> a null pair, and a
// zero base -> null percent, so a missing datum never fabricates a delta.
function delta(a, b) {
  if (!isNum(a) || !isNum(b)) return { abs: null, pct: null };
  return { abs: round2(b - a), pct: a !== 0 ? round2(((b - a) / a) * 100) : null };
}

// Shape one arm's row from the two consumed artifacts. cost_per_passed_story is
// taken straight from the cost artifact (already "n/a" at zero passed).
function armMetrics(id, cost, loop) {
  const rt = cost.run_total;
  const tel = (loop.signals && loop.signals.telemetry) || {};
  const passed = isNum(rt.passed) ? rt.passed : 0;
  const total = isNum(rt.total) ? rt.total : 0;
  return {
    id,
    label: (cost.tier && cost.tier.label) || 'unknown',
    est_cost_usd: isNum(rt.est_cost_usd) ? rt.est_cost_usd : 0,
    passed,
    total,
    pass_rate: total > 0 ? round2(passed / total) : 0,
    cost_per_passed_story: rt.cost_per_passed_story,
    turns_per_dispatch: turnsPerDispatch(tel.turns, tel.subagents),
  };
}

// Read one arm root. Missing/unreadable cost run_total or loop-health.json is a
// hard "arm-missing" for that arm (named), not a silent zero.
function readArm(id, root) {
  const cost = readJson(path.join(root, '.claude', 'state', 'cost-per-outcome.json'));
  const loop = readJson(path.join(root, 'specs', 'retro', 'loop-health.json'));
  const missing = [];
  if (!cost || !cost.run_total) {
    missing.push({ arm: id, artifact: '.claude/state/cost-per-outcome.json' });
  }
  if (!loop) missing.push({ arm: id, artifact: 'specs/retro/loop-health.json' });
  if (missing.length) return { ok: false, missing };
  return { ok: true, metrics: armMetrics(id, cost, loop) };
}

function buildDeltas(a, b) {
  return {
    est_cost_usd: delta(a.est_cost_usd, b.est_cost_usd),
    cost_per_passed_story: delta(a.cost_per_passed_story, b.cost_per_passed_story),
    pass_rate: delta(a.pass_rate, b.pass_rate),
    turns_per_dispatch: delta(a.turns_per_dispatch, b.turns_per_dispatch),
  };
}

const verdict = (winner, result, reason) => ({ winner, result, reason });

// The article's bar. Zero-passed arms are inconclusive (never a fake winner);
// otherwise the cheaper-per-passed-story arm wins ONLY at equal-or-better pass
// rate, an equal cost-per-passed-story is a tie, and a cheaper-but-worse arm is
// explicitly "no clear winner".
function computeVerdict(a, b) {
  if (a.passed === 0 && b.passed === 0) {
    return verdict(null, 'inconclusive', 'inconclusive: no passing stories in either arm');
  }
  if (a.passed === 0) {
    return verdict(null, 'inconclusive', `inconclusive: ${armName(a)} passed 0 of ${a.total}`);
  }
  if (b.passed === 0) {
    return verdict(null, 'inconclusive', `inconclusive: ${armName(b)} passed 0 of ${b.total}`);
  }
  const ca = a.cost_per_passed_story;
  const cb = b.cost_per_passed_story;
  if (ca === cb) return verdict(null, 'tie', `tie: equal cost per passed story ($${ca})`);
  const cheaper = ca < cb ? a : b;
  const other = cheaper === a ? b : a;
  const rates = `pass rate ${cheaper.pass_rate} vs ${other.pass_rate}`;
  if (cheaper.pass_rate >= other.pass_rate) {
    return verdict(cheaper.id, 'winner',
      `${armName(cheaper)} wins: cheaper per passed story ($${cheaper.cost_per_passed_story} `
      + `vs $${other.cost_per_passed_story}) at equal-or-better ${rates}`);
  }
  return verdict(null, 'no-clear-winner',
    `no clear winner — cheaper arm (${armName(cheaper)}) scored worse (${rates})`);
}

function buildReport(armAPath, armBPath) {
  const generated_at = new Date().toISOString();
  const a = readArm('armA', armAPath);
  const b = readArm('armB', armBPath);
  const missing = [...(a.ok ? [] : a.missing), ...(b.ok ? [] : b.missing)];
  if (missing.length) {
    const named = missing.map((m) => `${m.arm} ${m.artifact}`).join('; ');
    return { generated_at, status: 'arm-missing', missing, message: `arm-missing: ${named}` };
  }
  const v = computeVerdict(a.metrics, b.metrics);
  return {
    generated_at,
    status: v.result === 'inconclusive' ? 'inconclusive' : 'ok',
    arms: { armA: a.metrics, armB: b.metrics },
    deltas: buildDeltas(a.metrics, b.metrics),
    verdict: v,
  };
}

function cps(v) {
  return v === 'n/a' || v == null ? 'n/a' : `$${v}`;
}

function fmtArmLine(a) {
  return `  ${a.id} [${a.label}]: cost=$${a.est_cost_usd}  passed=${a.passed}/${a.total}  `
    + `cost/passed=${cps(a.cost_per_passed_story)}  turns/dispatch=${a.turns_per_dispatch}`;
}

function fmtReport(report) {
  if (report.status === 'arm-missing') return `A/B report: ${report.message}\n`;
  const lines = [`A/B report — status=${report.status}`];
  lines.push(fmtArmLine(report.arms.armA));
  lines.push(fmtArmLine(report.arms.armB));
  const d = report.deltas;
  lines.push(`Delta (B vs A): cost/passed=${d.cost_per_passed_story.abs} `
    + `(${d.cost_per_passed_story.pct == null ? 'n/a' : `${d.cost_per_passed_story.pct}%`})  `
    + `cost=${d.est_cost_usd.abs}  pass_rate=${d.pass_rate.abs}`);
  lines.push(`Verdict: ${report.verdict.reason}`);
  return `${lines.join('\n')}\n`;
}

function writeArtifact(outRoot, report) {
  const stateDir = path.join(outRoot, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'ab-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function parseArgs(argv) {
  const opts = { positionals: [], write: true, out: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--no-write') opts.write = false;
    else if (a === '--out') opts.out = argv[i += 1];
    else if (!a.startsWith('-')) opts.positionals.push(a);
  }
  opts.armA = opts.positionals[0];
  opts.armB = opts.positionals[1];
  return opts;
}

module.exports = {
  buildReport, fmtReport, writeArtifact, computeVerdict, turnsPerDispatch, delta,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.armA || !opts.armB) {
    process.stderr.write('usage: ab-report.js <armA-root> <armB-root> [--json] [--out dir] [--no-write]\n');
    process.exit(0);
  }
  const report = buildReport(opts.armA, opts.armB);
  if (opts.write) {
    try { writeArtifact(opts.out, report); } catch (_) { /* non-fatal */ }
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(fmtReport(report));
  process.exit(0);
}
