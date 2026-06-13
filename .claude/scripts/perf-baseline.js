#!/usr/bin/env node

'use strict';

// Performance baseline — "measure first" for brownfield change and the
// evaluator's latency ratchet. Samples endpoint latency into a baseline JSON;
// --compare re-samples after a change and fails (exit 1) on a p95 regression
// beyond the threshold. A change that passes every functional test can still
// silently double latency; this makes that visible.
//
// Method-aware: GET endpoints are warmed up and safe to sample repeatedly, so
// they get the regression ratchet. Non-GET (POST/PUT/PATCH/DELETE) requests
// carry a body and are NEVER warmed up (a warmup would replay the mutation and
// create extra records). Sampling a non-idempotent write many times is the
// caller's call — pass --samples 1 and --measure for a single-shot reading.
//
// CLI:
//   node .claude/scripts/perf-baseline.js [--base URL] [--endpoints /a,/b]
//        [--method GET] [--body '{"k":1}'] [--content-type application/json]
//        [--samples N] [--out FILE]                          capture mode
//   node .claude/scripts/perf-baseline.js --compare [--threshold PCT] [...]
//   node .claude/scripts/perf-baseline.js --measure [...]   print stats only
//
// capture  : measure, write the baseline file (the ratchet's reference point).
// --compare: measure, compare p95 to the baseline, exit 1 on regression.
// --measure: measure, print p50/p95/p99 to stdout, write nothing, exit 0.
//
// --base defaults to project-manifest.json#evaluation.api_base_url; endpoints
// default to the manifest health_check. Sampling is sequential (concurrency
// noise would corrupt the baseline).

const fs = require('fs');
const path = require('path');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
}

// Baseline key — GET stays a bare path (back-compat with existing baselines);
// other methods are prefixed so "GET /items" and "POST /items" never collide.
function endpointKey(method, endpoint) {
  return method === 'GET' ? endpoint : `${method} ${endpoint}`;
}

function fetchOptions(cfg) {
  const opts = { method: cfg.method };
  if (cfg.body != null) {
    opts.body = cfg.body;
    opts.headers = { 'content-type': cfg.contentType };
  }
  return opts;
}

async function sample(cfg, endpoint) {
  // The manifest's health_check may be a full URL; treat absolute endpoints
  // as-is instead of concatenating a doubled URL.
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : cfg.base.replace(/\/$/, '') + endpoint;
  const opts = fetchOptions(cfg);
  // Warm up only idempotent reads — never replay a mutating request, or the
  // warmup itself creates extra records and skews any record-count assertion.
  const warmups = cfg.method === 'GET' || cfg.method === 'HEAD' ? 2 : 0;
  for (let i = 0; i < warmups; i++) await fetch(url, opts).catch(() => {});
  const times = [];
  for (let i = 0; i < cfg.samples; i++) {
    const started = performance.now();
    const res = await fetch(url, opts);
    await res.arrayBuffer();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return {
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    samples: cfg.samples,
    method: cfg.method,
  };
}

function loadManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

function resolveConfig(argv) {
  const root = path.resolve(arg(argv, '--root', '.'));
  const evaluation = loadManifest(root).evaluation || {};
  const endpointsRaw = arg(argv, '--endpoints', evaluation.health_check || '/health');
  return {
    base: arg(argv, '--base', evaluation.api_base_url),
    endpoints: endpointsRaw.split(',').map((e) => e.trim()).filter(Boolean),
    method: arg(argv, '--method', 'GET').toUpperCase(),
    body: arg(argv, '--body', null),
    contentType: arg(argv, '--content-type', 'application/json'),
    samples: parseInt(arg(argv, '--samples', '20'), 10),
    out: arg(argv, '--out', path.join(root, 'specs', 'brownfield', 'perf-baseline.json')),
    threshold: parseFloat(arg(argv, '--threshold', '50')),
  };
}

function compareEndpoint(endpoint, before, after, threshold) {
  if (!before) return { endpoint, verdict: 'NEW', after };
  const deltaPct = before.p95 > 0 ? Math.round(((after.p95 - before.p95) / before.p95) * 100) : 0;
  const verdict = deltaPct > threshold ? 'REGRESSION' : 'OK';
  return { endpoint, verdict, deltaPct, before, after };
}

async function measureAll(cfg) {
  const current = {};
  for (const endpoint of cfg.endpoints) {
    current[endpointKey(cfg.method, endpoint)] = await sample(cfg, endpoint);
  }
  return current;
}

function writeBaseline(cfg, current) {
  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  fs.writeFileSync(cfg.out, JSON.stringify(
    { captured_at: new Date().toISOString(), base: cfg.base, endpoints: current }, null, 2));
  process.stdout.write(`Wrote ${cfg.out} (${cfg.endpoints.length} endpoint(s), ${cfg.samples} samples each)\n`);
  return 0;
}

function compareAll(cfg, current) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(cfg.out, 'utf8'));
  } catch (_) {
    process.stderr.write(`perf-baseline: no baseline at ${cfg.out} — capture one first (run without --compare)\n`);
    return 2;
  }
  let failed = false;
  for (const endpoint of cfg.endpoints) {
    const key = endpointKey(cfg.method, endpoint);
    const result = compareEndpoint(key, baseline.endpoints[key], current[key], cfg.threshold);
    if (result.verdict === 'REGRESSION') failed = true;
    const detail = result.before
      ? `p95 ${result.before.p95}ms -> ${result.after.p95}ms (${result.deltaPct >= 0 ? '+' : ''}${result.deltaPct}%)`
      : `p95 ${result.after.p95}ms (no prior baseline)`;
    process.stdout.write(`${result.verdict}: ${key} ${detail}\n`);
  }
  return failed ? 1 : 0;
}

function measureOnly(cfg, current) {
  for (const endpoint of cfg.endpoints) {
    const key = endpointKey(cfg.method, endpoint);
    const s = current[key];
    process.stdout.write(`MEASURE: ${key} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms (${s.samples} samples)\n`);
  }
  return 0;
}

async function main(argv) {
  const cfg = resolveConfig(argv);
  if (!cfg.base) {
    process.stderr.write('perf-baseline: no --base and no api_base_url in project-manifest.json\n');
    return 2;
  }
  let current;
  try {
    current = await measureAll(cfg);
  } catch (err) {
    process.stderr.write(`perf-baseline: endpoint unreachable (${err.message}) — is the app running?\n`);
    return 2;
  }
  if (argv.includes('--compare')) return compareAll(cfg, current);
  if (argv.includes('--measure')) return measureOnly(cfg, current);
  return writeBaseline(cfg, current);
}

module.exports = { percentile, compareEndpoint, endpointKey };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
