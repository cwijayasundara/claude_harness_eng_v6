'use strict';

// Deterministic plan-confidence scoring for the build pipeline.
//
// Mirrors build-chain-state.js: the scoring core is pure (takes an
// already-counted `signals` object, returns a band + score + drivers) so it
// can be unit-tested without file I/O. The thin gatherSignals layer takes an
// injectable text reader, and the CLI at the bottom does the real fs read and
// writes specs/plan-confidence.json.
//
// Confidence gates PLANNING only — it never touches the machine verification
// gates. See docs/proposals/confidence-gated-planning.md.

const DEFAULTS = Object.freeze({
  threshold: 0.6, // --auto proceeds when score >= threshold AND no hard trigger
  highThreshold: 0.85, // score >= this (and no hard trigger) is "high"
  weights: Object.freeze({
    openQuestion: 0.3, // per unanswered open question
    needsBreakdown: 0.25, // per story that could not be made `ready`
    brownfieldConflict: 0.3, // per plan/risk-map conflict with no strategy
    excessAssumption: 0.1, // per assumption beyond one-per-epic
    schemaGap: 0.15, // per endpoint/entity lacking substantive schema coverage
  }),
  // Signals that force the LOW band regardless of the numeric score: an
  // under-determined plan is low-confidence even if only one thing is open.
  hardLowSignals: Object.freeze(['openQuestions', 'needsBreakdown', 'brownfieldConflicts']),
});

const DEFAULT_PATHS = Object.freeze({
  brd: 'specs/brd/brd.md',
  epics: 'specs/stories/epics.md',
  backlog: 'specs/stories/backlog-needs-breakdown.md',
  apiSchema: 'specs/design/api-contracts.schema.json',
  dataSchema: 'specs/design/data-models.schema.json',
  riskMap: 'specs/brownfield/risk-map.md',
  changeStrategy: 'specs/brownfield/change-strategy.md',
});

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round2 = (n) => Math.round(n * 100) / 100;

function normalizeSignals(signals) {
  return {
    openQuestions: 0,
    needsBreakdown: 0,
    brownfieldConflicts: 0,
    assumptions: 0,
    epics: 1,
    schemaGaps: 0,
    ...signals,
  };
}

// One entry per scored signal: how many times it fired and what each costs.
function buildContributions(s, w) {
  const excessAssumptions = Math.max(0, s.assumptions - Math.max(1, s.epics));
  return [
    { signal: 'openQuestions', count: s.openQuestions, weight: w.openQuestion, detail: `${s.openQuestions} unanswered open question(s)` },
    { signal: 'needsBreakdown', count: s.needsBreakdown, weight: w.needsBreakdown, detail: `${s.needsBreakdown} story(ies) not decomposable to ready` },
    { signal: 'brownfieldConflicts', count: s.brownfieldConflicts, weight: w.brownfieldConflict, detail: `${s.brownfieldConflicts} brownfield risk conflict(s)` },
    { signal: 'assumptions', count: excessAssumptions, weight: w.excessAssumption, detail: `${excessAssumptions} assumption(s) beyond one per epic` },
    { signal: 'schemaGaps', count: s.schemaGaps, weight: w.schemaGap, detail: `${s.schemaGaps} schema coverage gap(s)` },
  ];
}

const driversFrom = (contribs) =>
  contribs
    .filter((c) => c.count > 0)
    .map((c) => ({ signal: c.signal, detail: c.detail, weight: -round2(c.count * c.weight) }));

const penaltyOf = (contribs) => contribs.reduce((sum, c) => sum + c.count * c.weight, 0);

function bandFor(score, hardLow, cfg) {
  if (hardLow || score < cfg.threshold) return 'low';
  if (score >= cfg.highThreshold) return 'high';
  return 'medium';
}

function computeConfidence(signals, config) {
  const cfg = { ...DEFAULTS, ...config };
  const w = { ...DEFAULTS.weights, ...(config && config.weights) };
  const s = normalizeSignals(signals);

  const contribs = buildContributions(s, w);
  const score = round2(clamp01(1 - penaltyOf(contribs)));
  const hardLow = cfg.hardLowSignals.some((name) => (s[name] || 0) > 0);

  return { band: bandFor(score, hardLow, cfg), score, threshold: cfg.threshold, hardLow, drivers: driversFrom(contribs) };
}

// ---- markdown parsers (pure) --------------------------------------------

// Body of a markdown section, from a heading whose text contains `name`
// (case-insensitive) up to the next heading of the same or higher level.
function sectionBody(md, name) {
  const lines = String(md || '').split('\n');
  const target = name.toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m && m[2].toLowerCase().includes(target)) {
      start = i + 1;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return '';
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function countListItems(body) {
  return String(body || '')
    .split('\n')
    .filter((l) => /^\s*([-*]|\d+\.)\s+\S/.test(l)).length;
}

// Data rows of a markdown table: lines starting with `|` minus the header row
// and the `|---|` separator. Returns 0 when there is no separator (no body).
function countTableDataRows(body) {
  const rows = String(body || '')
    .split('\n')
    .filter((l) => /^\s*\|/.test(l));
  const sepIdx = rows.findIndex((l) => /^\s*\|[\s|:-]+\|?\s*$/.test(l));
  if (sepIdx === -1) return 0;
  return rows.slice(sepIdx + 1).filter((l) => l.trim()).length;
}

function countEpics(md) {
  const ids = new Set((String(md || '').match(/\bE\d+\b/g) || []));
  return Math.max(1, ids.size);
}

// A schema entry is "hollow" when the planner declared it but left it without
// shape — an empty object, an `object` with no properties, or no schema
// keyword at all. Hollow entries are the concrete, deterministic form of a
// "schema coverage gap".
function isHollowSchema(v) {
  if (!v || typeof v !== 'object') return false;
  if (Object.keys(v).length === 0) return true; // {}
  if (v.type === 'object' && !v.properties) return true;
  const shaped = v.properties || v.enum || v.$ref || v.items || v.oneOf || v.anyOf || v.allOf || v.type;
  return !shaped;
}

// Counts hollow definitions in a JSON-Schema file. A file that exists but is
// non-empty-yet-unparseable is itself one gap (a stub the planner left behind);
// a missing file is no gap (the surface simply does not exist).
function countSchemaGaps(text) {
  if (!text || !text.trim()) return 0;
  let schema;
  try {
    schema = JSON.parse(text);
  } catch (_) {
    return 1;
  }
  const defs = schema.definitions || schema.$defs || schema.properties || {};
  return Object.values(defs).filter(isHollowSchema).length;
}

const countHighRiskRows = (md) =>
  String(md || '')
    .split('\n')
    .filter((l) => /^\s*\|/.test(l) && /\b(high|critical)\b/i.test(l)).length;

// High/critical risk seams with no documented change-strategy are unmitigated
// conflicts. A change-strategy doc is the planner's mitigation, so its presence
// clears them; absence leaves every high/critical row as a conflict.
function countBrownfieldConflicts(riskMap, changeStrategy) {
  const highRisk = countHighRiskRows(riskMap);
  if (highRisk === 0) return 0;
  return changeStrategy && changeStrategy.trim() ? 0 : highRisk;
}

// ---- signal gathering (I/O injected) ------------------------------------

// `readText(relPath)` returns file contents or null. Every signal is derived
// deterministically from the planning artifacts — open questions/assumptions
// from the BRD, undecomposable stories from the backlog, hollow schema
// definitions from the design schemas, and unmitigated high-risk seams from the
// brownfield maps.
function gatherSignals(readText, paths) {
  const p = { ...DEFAULT_PATHS, ...paths };
  const brd = readText(p.brd) || '';
  return {
    openQuestions: countListItems(sectionBody(brd, 'Open Questions')),
    assumptions: countListItems(sectionBody(brd, 'Assumptions')),
    epics: countEpics(readText(p.epics) || ''),
    needsBreakdown: countTableDataRows(readText(p.backlog) || ''),
    schemaGaps: countSchemaGaps(readText(p.apiSchema)) + countSchemaGaps(readText(p.dataSchema)),
    brownfieldConflicts: countBrownfieldConflicts(readText(p.riskMap), readText(p.changeStrategy)),
  };
}

module.exports = {
  DEFAULTS,
  DEFAULT_PATHS,
  computeConfidence,
  sectionBody,
  countListItems,
  countTableDataRows,
  countEpics,
  countSchemaGaps,
  countBrownfieldConflicts,
  gatherSignals,
  parseCliArgs,
};

// ---- CLI ----------------------------------------------------------------

function loadConfig(readText) {
  const calib = readText('calibration-profile.json');
  if (!calib) return undefined;
  try {
    return JSON.parse(calib).plan_confidence;
  } catch {
    return undefined; // malformed profile → defaults
  }
}

function parseCliArgs(argv) {
  // Supports: plan-confidence.js [root] [--gate] [--root path]
  // --gate: exit 0 when band is high|medium, exit 2 when low (headless stop signal).
  let root = '.';
  let gate = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--gate') gate = true;
    else if (a === '--root') root = argv[++i] || root;
    else if (!a.startsWith('-')) root = a;
  }
  return { root, gate };
}

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { root, gate } = parseCliArgs(process.argv);
  const readText = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  const signals = gatherSignals(readText);
  const result = computeConfidence(signals, loadConfig(readText));
  const artifact = { ...result, signals, computed_at: new Date().toISOString() };

  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'plan-confidence.json'), JSON.stringify(artifact, null, 2) + '\n');

  const detail = result.drivers.map((d) => d.detail).join(', ') || 'no risk drivers';
  process.stdout.write(`Plan confidence: ${result.band.toUpperCase()} (score ${result.score}) — ${detail}\n`);

  if (gate) {
    // Exit 2 = still low after planning/clarify: callers must stop unattended builds.
    // Exit 0 = high|medium: safe to proceed to implementation.
    if (result.band === 'low') {
      process.stderr.write(
        'plan-confidence --gate: band is LOW — do not start /auto unattended. ' +
          'Resolve drivers (or run /clarify once and recompute), then retry.\n'
      );
      process.exit(2);
    }
    process.exit(0);
  }
}
