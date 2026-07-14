'use strict';

// Loop-health scorecard (agentic-flywheel §4.1). Pure helpers that condense
// the run-state this harness's OWN sensors already write into a single
// deterministic scorecard — the "attenuation" half of the human-on-the-loop
// control system (a condensed dashboard, not the raw ledger). It invents no
// new measurements and applies no thresholds beyond a few factual notes:
// interpretation is the inferential job of the /retro recommender that reads
// this file. Report-only; the orchestrator (scripts/loop-health.js) exits 0
// always. See docs/agentic-flywheel-design.md.

const fs = require('fs');
const path = require('path');
const { readOutcomes } = require('./sensor-outcomes');

function stripComments(md) {
  return String(md || '').replace(/<!--[\s\S]*?-->/g, '');
}

// A failures.md entry is `## Group <id> — Failure #<n>`; the shipped file keeps
// the template inside an HTML comment, so comments must be stripped first.
function parseFailures(text) {
  const body = stripComments(text);
  const total = (body.match(/^##\s+Group\b.*Failure\s*#\d+/gim) || []).length;
  const byCategory = {};
  const catRe = /-\s*\*\*Category:\*\*\s*([a-z_]+)/gi;
  let m;
  while ((m = catRe.exec(body))) {
    byCategory[m[1]] = (byCategory[m[1]] || 0) + 1;
  }
  return { total, byCategory };
}

// learned-rules.md entries are h2 (`## Rule N`); process-rules.md entries are
// h3 (`### PR-default-NN`). Match both, but not the h1 file title.
function countRules(text) {
  return (stripComments(text).match(/^#{2,3}\s+/gm) || []).length;
}

function summarizeTelemetry(lines) {
  const out = {
    events: 0, tools: 0, toolErrors: 0, turns: 0, prompts: 0, subagents: 0, byLane: {},
  };
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    out.events += 1;
    if (o.lane) out.byLane[o.lane] = (out.byLane[o.lane] || 0) + 1;
    switch (o.kind) {
      case 'tool':
        out.tools += 1;
        if (o.exit && o.exit !== 'ok') out.toolErrors += 1;
        break;
      case 'turn': out.turns += 1; break;
      case 'prompt': out.prompts += 1; break;
      case 'subagent_stop': out.subagents += 1; break;
      default: break;
    }
  }
  out.toolErrorRate = out.tools ? Number((out.toolErrors / out.tools).toFixed(4)) : 0;
  return out;
}

function readText(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; }
}

function readLines(root, rel) {
  const raw = readText(root, rel).trim();
  return raw ? raw.split('\n') : [];
}

function readFlakeCount(root) {
  return readLines(root, 'specs/drift/flake-history.jsonl').filter(Boolean).length;
}

function readBaselineNum(root, rel) {
  const raw = readText(root, rel).trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const MIN_RUNS = 5;

function commitGateIds() {
  try { return require('./gate-registry').GATE_CATALOG.map((g) => g.id); }
  catch (_) { return []; }
}

// "Runs" = distinct commit timestamps clustered per gate is overkill; use the
// count of the most-frequently-seen gate as a proxy for how many commits ran.
function analyzeBiting(root) {
  const ids = commitGateIds();
  const outcomes = readOutcomes(root);
  const seen = new Map(); // id -> { fired, blocked }
  for (const o of outcomes) {
    const s = seen.get(o.sensor) || { fired: 0, blocked: 0 };
    if (o.ran) s.fired += 1;
    if (o.blocked) s.blocked += 1;
    seen.set(o.sensor, s);
  }
  const runs = ids.reduce((max, id) => Math.max(max, (seen.get(id) || { fired: 0 }).fired), 0);
  const accruing = runs < MIN_RUNS;
  const neverFired = ids.filter((id) => !(seen.get(id) && seen.get(id).fired > 0));
  const neverBlocked = ids.filter((id) => seen.get(id) && seen.get(id).fired > 0 && seen.get(id).blocked === 0);
  return { runs, accruing, neverFired: accruing ? [] : neverFired, neverBlocked: accruing ? [] : neverBlocked, unwired: [] };
}

// A single lane dominating the ledger means turns/prompts/subagent counts in
// the scorecard mostly reflect that one lane, not overall SDLC activity.
function laneSkewNote(telemetry) {
  const laneEntries = Object.entries(telemetry.byLane || {});
  if (telemetry.events < 20 || !laneEntries.length) return null;
  const [topLane, topCount] = laneEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const share = topCount / telemetry.events;
  if (share < 0.9) return null;
  return `Lane "${topLane}" accounts for ${(share * 100).toFixed(1)}% of ${telemetry.events} events — `
    + 'scorecard signals may be skewed toward this lane.';
}

// Deterministic, evidence-backed observations only. These are facts the /retro
// agent should not have to re-derive — not scored health verdicts.
function deriveNotes(signals) {
  const notes = [];
  const { failures, learnedRules, telemetry, flakeEvents } = signals;
  if (failures.total > 0 && learnedRules === 0) {
    notes.push(
      `${failures.total} failure(s) logged but no learned rules extracted — ` +
      'candidate for a rule-add recommendation.',
    );
  }
  const repeated = Object.entries(failures.byCategory).filter(([, n]) => n >= 2);
  for (const [cat, n] of repeated) {
    notes.push(`Failure category "${cat}" recurred ${n}× — SECTION 12 rule-extraction threshold met.`);
  }
  if (telemetry.tools >= 20 && telemetry.toolErrorRate >= 0.1) {
    notes.push(
      `Tool error rate ${(telemetry.toolErrorRate * 100).toFixed(1)}% over ${telemetry.tools} calls ` +
      '— above the 10% attention line.',
    );
  }
  if (flakeEvents > 0) {
    notes.push(`${flakeEvents} flake event(s) in history — check regression-gate quarantine coverage.`);
  }
  const laneNote = laneSkewNote(telemetry);
  if (laneNote) notes.push(laneNote);
  notes.push(...bitingNotes(signals.biting));
  return notes;
}

// Facts about whether commit gates actually fire/block, derived from
// analyzeBiting — split out of deriveNotes to keep it under the length gate.
function bitingNotes(biting) {
  if (!biting) return [];
  if (biting.accruing) {
    return [`Sensor-biting history accruing (${biting.runs}/${MIN_RUNS} commit runs) — biting analysis deferred.`];
  }
  const notes = [];
  if (biting.neverBlocked.length) {
    notes.push(`${biting.neverBlocked.length} commit gate(s) fired but never blocked over ${biting.runs} runs (${biting.neverBlocked.join(', ')}) — possible miscalibration.`);
  }
  if (biting.neverFired.length) {
    notes.push(`${biting.neverFired.length} commit gate(s) never fired (${biting.neverFired.join(', ')}) — dead or unreached.`);
  }
  return notes;
}

function buildScorecard(root) {
  const signals = {
    telemetry: summarizeTelemetry(readLines(root, '.claude/state/telemetry-ledger.jsonl')),
    failures: parseFailures(readText(root, '.claude/state/failures.md')),
    learnedRules: countRules(readText(root, '.claude/state/learned-rules.md')),
    processRules: countRules(readText(root, '.claude/state/process-rules.md')),
    flakeEvents: readFlakeCount(root),
    biting: analyzeBiting(root),
    baselines: {
      cycle: readBaselineNum(root, '.claude/state/cycle-baseline.txt'),
      coupling: readBaselineNum(root, '.claude/state/coupling-baseline.txt'),
      coverage: readBaselineNum(root, '.claude/state/coverage-baseline.txt'),
      coverageJs: readBaselineNum(root, '.claude/state/coverage-baseline-js.txt'),
    },
  };
  return { signals, notes: deriveNotes(signals) };
}

// Sorted by count desc so the dominant lane is immediately visible.
function laneActivityLines(byLane) {
  const entries = Object.entries(byLane || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return ['- No lane data.'];
  const rows = ['| Lane | Events |', '|---|---|'];
  for (const [lane, count] of entries) rows.push(`| ${lane} | ${count} |`);
  return rows;
}

function renderMd(scorecard, generatedAt) {
  const { signals, notes } = scorecard;
  const t = signals.telemetry;
  const b = signals.baselines;
  const lines = [
    '# Loop-health scorecard', '', `Generated: ${generatedAt}`, '',
    '## Signals', '',
    '| Signal | Value |', '|---|---|',
    `| Telemetry events | ${t.events} |`,
    `| Tool calls (errors) | ${t.tools} (${t.toolErrors}, ${(t.toolErrorRate * 100).toFixed(1)}%) |`,
    `| Turns / prompts / subagents | ${t.turns} / ${t.prompts} / ${t.subagents} |`,
    `| Failures logged | ${signals.failures.total} |`,
    `| Learned / process rules | ${signals.learnedRules} / ${signals.processRules} |`,
    `| Flake events | ${signals.flakeEvents} |`,
    `| Baselines (cycle / coupling / cov / covJs) | ${b.cycle} / ${b.coupling} / ${b.coverage} / ${b.coverageJs} |`,
    '',
    '## Lane activity', '',
    ...laneActivityLines(t.byLane),
    '',
    '## Observations', '',
  ];
  if (!notes.length) lines.push('- No deterministic observations flagged this run.');
  for (const n of notes) lines.push(`- ${n}`);
  lines.push('', '> Interpretation and scored recommendations are the job of `/retro`, which reads this scorecard.', '');
  return lines.join('\n');
}

module.exports = {
  stripComments, parseFailures, countRules, summarizeTelemetry,
  readFlakeCount, readBaselineNum, deriveNotes, buildScorecard, renderMd,
  analyzeBiting,
};
