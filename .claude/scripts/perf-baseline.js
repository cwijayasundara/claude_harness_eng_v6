#!/usr/bin/env node

'use strict';

// Performance baseline — "measure first" for brownfield change. Samples
// endpoint latency into specs/brownfield/perf-baseline.json before work
// begins; --compare re-samples after the change and fails (exit 1) on a p95
// regression beyond the threshold. A change that passes every functional test
// can still silently double latency; this makes that visible.
//
// CLI:
//   node .claude/scripts/perf-baseline.js [--base URL] [--endpoints /a,/b]
//        [--samples N] [--out FILE]            capture mode
//   node .claude/scripts/perf-baseline.js --compare [--threshold PCT] [...]
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

async function sample(base, endpoint, samples) {
  // The manifest's health_check may be a full URL; treat absolute endpoints
  // as-is instead of concatenating a doubled URL.
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : base.replace(/\/$/, '') + endpoint;
  for (let i = 0; i < 2; i++) await fetch(url).catch(() => {}); // warmup
  const times = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    const res = await fetch(url);
    await res.arrayBuffer();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 50), p95: percentile(times, 95), p99: percentile(times, 99), samples };
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
    current[endpoint] = await sample(cfg.base, endpoint, cfg.samples);
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
    const result = compareEndpoint(endpoint, baseline.endpoints[endpoint], current[endpoint], cfg.threshold);
    if (result.verdict === 'REGRESSION') failed = true;
    const detail = result.before
      ? `p95 ${result.before.p95}ms -> ${result.after.p95}ms (${result.deltaPct >= 0 ? '+' : ''}${result.deltaPct}%)`
      : `p95 ${result.after.p95}ms (no prior baseline)`;
    process.stdout.write(`${result.verdict}: ${endpoint} ${detail}\n`);
  }
  return failed ? 1 : 0;
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
  return argv.includes('--compare') ? compareAll(cfg, current) : writeBaseline(cfg, current);
}

module.exports = { percentile, compareEndpoint };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
