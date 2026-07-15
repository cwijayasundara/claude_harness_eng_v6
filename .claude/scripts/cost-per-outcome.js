#!/usr/bin/env node

'use strict';

// Phase 0 "prove the lead" benchmark: cost-per-passed-story from harness run
// receipts joined to the feature ledger. Report-only, deterministic, exit 0
// always — it makes a future Haiku-worker-vs-Sonnet decision evidence-based
// instead of guessed, but it never changes agent behavior on its own.
//
// It reuses existing machinery rather than reimplementing it:
//   - receiptCost (budget-state.js)                 — pricing (tokens or rate seed)
//   - readRunReceipts / readFeatures (pipeline-state-readers.js) — state I/O + tally
//   - PRESETS / OPUS / SONNET5 / HAIKU (model-tier.js)           — tier reverse-inference
//
// Two honest caveats travel with every report (see CAVEATS): attribution is
// per-GROUP (story_id is often "none", so finer precision is not guaranteed),
// and the tier LABEL is inferred from the recorded model pins, not stamped.

const fs = require('fs');
const path = require('path');
const { receiptCost } = require('./budget-state');
const { readRunReceipts, readFeatures } = require('./pipeline-state-readers');
const {
  OPUS, SONNET5, HAIKU,
} = require('./model-tier');

const round2 = (n) => Math.round(n * 100) / 100;

const CAVEATS = Object.freeze([
  'Attribution is per-GROUP: receipts carry group_id but story_id is often "none", '
    + 'so precision finer than a story group is not guaranteed.',
  'Tier label is INFERRED from the recorded model pins, not stamped. A cost-tier run '
    + 'with token-less receipts is indistinguishable from balanced and is priced at the '
    + 'balanced rate-seed (an overestimate); token-bearing receipts are priced exactly by model.',
]);

// cost / passed, or "n/a" when nothing passed — never a divide-by-zero crash.
function costPerPassed(cost, passed) {
  return passed > 0 ? round2(cost / passed) : 'n/a';
}

// Reverse-infer the tier LABEL from the model mix actually recorded on receipts.
// Presets share the Opus judgment pins, so the discriminators are the generation,
// worker, and exploration pins: a Haiku IMPLEMENTER (worker) is unique to fusion,
// a Haiku codebase-explorer is unique to cost/enterprise, and an Opus generator
// only appears on max-quality. Check fusion BEFORE cost so a Haiku worker is not
// mislabeled 'cost' (fusion has explorer=Sonnet5, cost has implementer=Sonnet5,
// so the two Haiku pins are mutually exclusive in the real presets). Best-effort
// + honest note.
function inferTier(receipts) {
  const subs = (receipts || []).filter((r) => r.kind === 'subagent' && r.model);
  const models = new Set(subs.map((r) => r.model));
  if (!models.size) {
    return { label: 'unknown', note: 'no model pins recorded on receipts' };
  }
  const genModels = new Set(subs.filter((r) => r.agent === 'generator').map((r) => r.model));
  const implModels = new Set(subs.filter((r) => r.agent === 'implementer').map((r) => r.model));
  const explModels = new Set(subs.filter((r) => r.agent === 'codebase-explorer').map((r) => r.model));
  if (implModels.has(HAIKU)) {
    return { label: 'fusion', note: `${HAIKU} implementer pin observed — fusion` };
  }
  if (explModels.has(HAIKU)) {
    return { label: 'cost', note: `${HAIKU} explorer pin observed (cost/enterprise)` };
  }
  if (genModels.has(OPUS)) {
    return { label: 'max-quality', note: `generator pinned to ${OPUS}` };
  }
  if (genModels.has(SONNET5)) {
    return {
      label: 'balanced',
      note: `${SONNET5} generation, no ${HAIKU}/opus-gen (cost indistinguishable without a haiku explorer)`,
    };
  }
  if (models.has(HAIKU)) {
    return { label: 'cost', note: `${HAIKU} pin observed, unattributed (cost/enterprise, defensive)` };
  }
  return { label: 'unknown', note: 'no generation pin to disambiguate' };
}

// Bucket subagent-receipt cost by group_id (defaulting the unattributed to "none").
function bucketCostByGroup(receipts, tier) {
  const subs = (receipts || []).filter((r) => r.kind === 'subagent');
  const byGroup = {};
  let total = 0;
  for (const r of subs) {
    const g = r.group_id || 'none';
    const c = receiptCost(r, tier);
    byGroup[g] = (byGroup[g] || 0) + c;
    total += c;
  }
  return { byGroup, total, count: subs.length };
}

// readFeatures returns by_group as "p/t" strings — parse back to numbers for the join.
function parseFeatureGroups(features) {
  const out = {};
  for (const [g, pt] of Object.entries((features && features.by_group) || {})) {
    const m = String(pt).match(/^(\d+)\/(\d+)$/);
    out[g] = m ? { passed: Number(m[1]), total: Number(m[2]) } : { passed: 0, total: 0 };
  }
  return out;
}

function readTier(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
    return (m.execution && m.execution.model_tier) || 'balanced';
  } catch (_) {
    return 'balanced';
  }
}

// Join the cost buckets and the feature tally on the group key (union of both).
function joinGroups(costByGroup, featGroups) {
  const groups = [...new Set([...Object.keys(costByGroup), ...Object.keys(featGroups)])].sort();
  return groups.map((g) => {
    const est = round2(costByGroup[g] || 0);
    const f = featGroups[g] || { passed: 0, total: 0 };
    return {
      group: g,
      est_cost_usd: est,
      passed: f.passed,
      total: f.total,
      cost_per_passed_story: costPerPassed(est, f.passed),
    };
  });
}

function deriveStatus(subCount, featureTotal) {
  const noRuns = subCount === 0;
  const noFeatures = featureTotal === 0;
  if (noRuns && noFeatures) return 'no-data';
  if (noRuns) return 'no-runs';
  if (noFeatures) return 'no-features';
  return 'ok';
}

function buildReport(root) {
  const receipts = readRunReceipts(root);
  const inferred = inferTier(receipts);
  // Price with the inferred tier when known (reflects the models actually used);
  // fall back to the manifest tier only when inference could not decide.
  const pricingTier = inferred.label !== 'unknown' ? inferred.label : readTier(root);

  const { byGroup: costByGroup, total: totalCost, count: subCount } = bucketCostByGroup(receipts, pricingTier);
  const features = readFeatures(root); // { passing, total, by_group: { g: "p/t" } }
  const runCost = round2(totalCost);

  return {
    generated_at: new Date().toISOString(),
    status: deriveStatus(subCount, features.total),
    tier: { label: inferred.label, inferred: true, note: inferred.note },
    pricing_tier: pricingTier,
    run_total: {
      est_cost_usd: runCost,
      passed: features.passing,
      total: features.total,
      cost_per_passed_story: costPerPassed(runCost, features.passing),
    },
    by_group: joinGroups(costByGroup, parseFeatureGroups(features)),
    caveats: [...CAVEATS],
    subagent_count: subCount,
    feature_count: features.total,
    receipt_count: receipts.length,
  };
}

function fmtStatusLine(status) {
  if (status === 'no-data') return '  no runs and no features on disk — nothing to benchmark yet.';
  if (status === 'no-runs') return '  no subagent receipts found — cost cannot be attributed yet.';
  if (status === 'no-features') return '  no features found — passed-story count is 0; showing cost only.';
  return null;
}

function fmtReport(report) {
  const rt = report.run_total;
  const rtCps = rt.cost_per_passed_story === 'n/a' ? 'n/a' : `~$${rt.cost_per_passed_story}`;
  const lines = [
    `Cost-per-passed-story — tier=${report.tier.label} (inferred, not stamped)  status=${report.status}`,
  ];
  const statusLine = fmtStatusLine(report.status);
  if (statusLine) lines.push(statusLine);
  lines.push(`Run total: ~$${rt.est_cost_usd}  passed=${rt.passed}/${rt.total}  cost/passed=${rtCps}`);
  if (report.by_group.length) {
    lines.push('By group:');
    for (const g of report.by_group) {
      const cps = g.cost_per_passed_story === 'n/a' ? 'n/a' : `~$${g.cost_per_passed_story}`;
      lines.push(`  ${g.group}: ~$${g.est_cost_usd}  passed=${g.passed}/${g.total}  cost/passed=${cps}`);
    }
  }
  lines.push('Caveats:');
  for (const c of report.caveats) lines.push(`  - ${c}`);
  return `${lines.join('\n')}\n`;
}

function writeArtifact(root, report) {
  const stateDir = path.join(root, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'cost-per-outcome.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function parseArgs(argv) {
  const opts = { root: '.', write: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--no-write') opts.write = false;
    else if (a === '--root') opts.root = argv[i += 1];
    else if (!a.startsWith('-')) opts.root = a;
  }
  return opts;
}

module.exports = {
  buildReport,
  fmtReport,
  writeArtifact,
  inferTier,
  costPerPassed,
  CAVEATS,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildReport(opts.root);
  if (opts.write) {
    try { writeArtifact(opts.root, report); } catch (_) { /* non-fatal */ }
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(fmtReport(report));
  process.exit(0);
}
