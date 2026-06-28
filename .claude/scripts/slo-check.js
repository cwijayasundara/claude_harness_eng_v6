#!/usr/bin/env node

'use strict';

// Runtime-SLO sensor (gap G9 sensor-half). Scrapes a generated app's RED
// /metrics endpoint and checks two budgets from project-manifest.json#observability.slo:
//   - 5xx error-rate (%)  -> exit 1 (FAIL) when over budget
//   - p95 latency (ms)    -> exit 2 (WARN) when over budget (regression is the perf ratchet's job)
// Reusable: /evaluate folds in specs/reviews/slo-verdict.json (app already booted);
// `npm run slo -- --url <live>` runs it standalone for the scheduled/drift cadence.
//
// CLI:
//   node .claude/scripts/slo-check.js [--url URL] [--metrics-path /metrics]
//        [--fixture FILE] [--root DIR]
// --fixture reads exposition text from a file instead of HTTP (hermetic tests).
// Exit: 0 pass/disabled, 1 error-rate breach, 2 p95-only / no-traffic / unreachable.

const fs = require('fs');
const path = require('path');
const { parseProm, errorRate, histogramP95 } = require('../hooks/lib/prom-parse.js');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function loadManifest(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); }
  catch { return {}; }
}

function resolveBase(manifest, argv) {
  const cli = arg(argv, '--url', null);
  if (cli) return cli;
  const v = manifest.verification || {};
  if (v.mode === 'local' && v.local && v.local.backend_url) return v.local.backend_url;
  return (manifest.evaluation && manifest.evaluation.api_base_url) || 'http://localhost:8000';
}

async function fetchMetrics(url, retries) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

function finish(outPath, verdict, code) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2));
  } catch (e) {
    process.stderr.write(`slo-check: could not write verdict file: ${e.message}\n`);
  }
  process.stdout.write(JSON.stringify({ ...verdict, exit: code }) + '\n');
  process.exit(code);
}

// Retrieve raw Prometheus text from fixture file or live HTTP endpoint.
async function scrapeMetrics(argv, manifest, obs) {
  const metricsPath = arg(argv, '--metrics-path', obs.metrics_path || '/metrics');
  const fixture = arg(argv, '--fixture', null);
  if (fixture) return { text: fs.readFileSync(fixture, 'utf8'), scraped: fixture };
  const base = resolveBase(manifest, argv).replace(/\/$/, '');
  const scraped = base + metricsPath;
  const text = await fetchMetrics(scraped, 3);
  return { text, scraped };
}

// Compute breach list and exit-code from parsed Prometheus series.
function evalSlo(series, slo) {
  const er = errorRate(series);
  const p95 = histogramP95(series);
  const breaches = [];
  if (er != null && er > slo.error_rate_pct) breaches.push('error_rate');
  if (p95 != null && p95 > slo.p95_ms) breaches.push('p95');
  let code = 0;
  let verdict = 'pass';
  if (breaches.includes('error_rate')) { code = 1; verdict = 'fail'; }
  else if (breaches.includes('p95') || er == null) { code = 2; verdict = 'warn'; }
  return { er, p95, breaches, code, verdict };
}

async function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const manifest = loadManifest(root);
  const obs = manifest.observability || {};
  const outPath = path.join(root, 'specs', 'reviews', 'slo-verdict.json');

  if (obs.enabled === false) return finish(outPath, { verdict: 'disabled', error_rate_pct: null, p95_ms: null, breaches: [] }, 0);

  const slo = obs.slo || { error_rate_pct: 1.0, p95_ms: 500 };
  const got = await scrapeMetrics(argv, manifest, obs);
  if (got.text == null) return finish(outPath, { verdict: 'unreachable', error_rate_pct: null, p95_ms: null, scraped: got.scraped, breaches: [] }, 2);

  const series = parseProm(got.text);
  const { er, p95, breaches, code, verdict } = evalSlo(series, slo);

  return finish(outPath, {
    verdict, error_rate_pct: er, p95_ms: p95,
    budgets: { error_rate_pct: slo.error_rate_pct, p95_ms: slo.p95_ms },
    breaches, scraped: got.scraped,
  }, code);
}

main();
