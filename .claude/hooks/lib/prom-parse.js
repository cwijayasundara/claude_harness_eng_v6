'use strict';

// Pure Prometheus text-exposition parser for the runtime-SLO sensor (gap G9
// sensor-half). No I/O — fed raw text so it is unit-testable without a running
// app. Computes the two RED signals the product /metrics exposes: 5xx
// error-rate (percent) and p95 request latency (ms) via histogram-quantile.

function parseLabels(block) {
  const labels = {};
  if (!block) return labels;
  const inner = block.slice(1, -1); // strip { }
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

// Parse `name{labels} value` lines; skip blanks and # comments.
function parseProm(text) {
  const series = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(.+)$/);
    if (!m) continue;
    const value = Number(m[3]);
    if (!Number.isFinite(value)) continue;
    series.push({ name: m[1], labels: parseLabels(m[2]), value });
  }
  return series;
}

// 5xx error-rate as a percent (0-100). null when there is no traffic.
function errorRate(series) {
  let total = 0;
  let errors = 0;
  for (const s of series) {
    if (s.name !== 'http_requests_total') continue;
    total += s.value;
    if (/^5/.test(String(s.labels.status || ''))) errors += s.value;
  }
  if (total === 0) return null;
  return (errors / total) * 100;
}

// Interpolate within a histogram bucket crossing. Pure helper to keep
// histogramP95 under the 30-line function cap.
function _interpolate(rank, prevLe, prevC, bucket) {
  const upper = bucket.le === Infinity ? prevLe : bucket.le;
  const span = upper - prevLe;
  const frac = bucket.c > prevC ? (rank - prevC) / (bucket.c - prevC) : 0;
  return (prevLe + span * frac) * 1000; // seconds -> ms
}

// p95 latency in ms via Prometheus histogram-quantile over the cumulative
// *_bucket series (the `le` label). null when no buckets / no observations.
function histogramP95(series) {
  const buckets = [];
  let count = 0;
  for (const s of series) {
    if (s.name === 'http_request_duration_seconds_bucket' && s.labels.le != null) {
      buckets.push({ le: s.labels.le === '+Inf' ? Infinity : Number(s.labels.le), c: s.value });
    } else if (s.name === 'http_request_duration_seconds_count') {
      count += s.value;
    }
  }
  if (buckets.length === 0 || count === 0) return null;
  buckets.sort((a, b) => a.le - b.le);
  const rank = 0.95 * count;
  let prevLe = 0;
  let prevC = 0;
  for (const b of buckets) {
    if (b.c >= rank) return _interpolate(rank, prevLe, prevC, b);
    if (b.le !== Infinity) { prevLe = b.le; }
    prevC = b.c;
  }
  return prevLe * 1000;
}

module.exports = { parseProm, parseLabels, errorRate, histogramP95 };
