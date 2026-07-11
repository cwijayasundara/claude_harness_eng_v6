#!/usr/bin/env node

'use strict';

// Operator-facing cost report from harness run receipts. Surfaces estimated
// and (when present) measured $ + model mix. Does not change agent behavior.

const fs = require('fs');
const path = require('path');
const {
  costSummary,
  modelMix,
  estimateCost,
  costSource,
  receiptCost,
  MODEL_PRICE,
} = require('./budget-state');

function readReceipts(root, { day, session } = {}) {
  const dir = path.join(root, '.claude', 'runs');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch (_) {
    return [];
  }
  if (day) files = files.filter((f) => f.startsWith(day));
  const rows = files.flatMap((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8')
      .split(/\n+/)
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean));
  if (session) return rows.filter((r) => r.session_id === session);
  return rows;
}

function readTier(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
    return (m.execution && m.execution.model_tier) || 'balanced';
  } catch (_) {
    return 'balanced';
  }
}

function agentCounts(receipts) {
  const out = {};
  for (const r of receipts) {
    if (r.kind !== 'subagent') continue;
    const a = r.agent || 'unknown';
    out[a] = (out[a] || 0) + 1;
  }
  return out;
}

function laneBreakdown(receipts, tier) {
  const out = {};
  for (const r of receipts) {
    if (r.kind !== 'subagent') continue;
    const lane = r.lane || 'unknown';
    if (!out[lane]) out[lane] = { agents: 0, est_cost_usd: 0 };
    out[lane].agents += 1;
    out[lane].est_cost_usd += receiptCost(r, tier);
  }
  for (const row of Object.values(out)) {
    row.est_cost_usd = Math.round(row.est_cost_usd * 100) / 100;
  }
  return out;
}

// Flag models that are not in MODEL_PRICE keys (except unknown) — soft drift.
function unexpectedModels(mix, pins) {
  const pinSet = new Set(Object.values(pins || {}));
  const known = new Set(Object.keys(MODEL_PRICE).filter((k) => k !== 'default'));
  const unexpected = [];
  for (const model of Object.keys(mix || {})) {
    if (model === 'unknown') continue;
    if (pinSet.size && !pinSet.has(model) && !known.has(model)) {
      unexpected.push(model);
    } else if (!known.has(model) && model !== 'unknown') {
      unexpected.push(model);
    }
  }
  return unexpected;
}

function buildReport(root, opts = {}) {
  const tier = opts.tier || readTier(root);
  const receipts = readReceipts(root, opts);
  const started = opts.startedAtMs || null;
  const summary = costSummary(receipts, started, opts.nowMs || Date.now(), tier);
  const mix = modelMix(receipts, tier);
  let pins = {};
  try {
    const { modelsForTier } = require('./model-tier');
    pins = modelsForTier(tier);
  } catch (_) {
    pins = {};
  }
  return {
    generated_at: new Date().toISOString(),
    tier,
    source: costSource(receipts),
    est_cost_usd: Math.round(estimateCost(receipts, tier) * 100) / 100,
    agents: summary.agents,
    worker_pct: summary.worker_pct,
    model_mix: mix,
    agents_by_role: agentCounts(receipts),
    by_lane: laneBreakdown(receipts, tier),
    input_tokens: summary.input_tokens,
    output_tokens: summary.output_tokens,
    cache_read_tokens: summary.cache_read_tokens,
    cache_read_share_pct: summary.cache_read_share_pct,
    unexpected_models: unexpectedModels(mix, pins),
    receipt_count: receipts.length,
    filters: {
      day: opts.day || null,
      session: opts.session || null,
    },
  };
}

function fmtReport(report) {
  const lines = [
    `Cost report — tier=${report.tier}  source=${report.source}`,
    `Total:     ~$${report.est_cost_usd}  agents=${report.agents}` +
      (report.worker_pct != null ? `  worker=${report.worker_pct}%` : ''),
  ];
  if (report.input_tokens || report.output_tokens || report.cache_read_tokens) {
    lines.push(
      `Tokens:    in=${report.input_tokens || 0}  out=${report.output_tokens || 0}` +
      `  cache_read=${report.cache_read_tokens || 0}` +
      (report.cache_read_share_pct != null ? `  (${report.cache_read_share_pct}% cache-read)` : ''),
    );
  }
  const mixKeys = Object.keys(report.model_mix || {}).sort();
  if (mixKeys.length) {
    lines.push('Models:');
    for (const m of mixKeys) {
      const row = report.model_mix[m];
      lines.push(`  ${m}: agents=${row.agents}  ~$${row.est_cost_usd}`);
    }
  }
  const roles = Object.keys(report.agents_by_role || {}).sort();
  if (roles.length) {
    lines.push(`Roles:     ${roles.map((r) => `${r}=${report.agents_by_role[r]}`).join(' ')}`);
  }
  if (report.unexpected_models && report.unexpected_models.length) {
    lines.push(`Drift:     unexpected models: ${report.unexpected_models.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeArtifact(root, report) {
  const stateDir = path.join(root, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'cost-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv) {
  const opts = { root: '.', write: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--no-write') opts.write = false;
    else if (a === '--day') opts.day = argv[++i];
    else if (a === '--session') opts.session = argv[++i];
    else if (a === '--root') opts.root = argv[++i];
    else if (!a.startsWith('-')) opts.root = a;
  }
  return opts;
}

module.exports = {
  buildReport,
  fmtReport,
  readReceipts,
  unexpectedModels,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildReport(opts.root, opts);
  if (opts.write) {
    try { writeArtifact(opts.root, report); } catch (_) { /* non-fatal */ }
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(fmtReport(report));
}
