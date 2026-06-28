'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { parseProm, errorRate, histogramP95 } = require('../.claude/hooks/lib/prom-parse.js');

const SAMPLE = `# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/items",status="200"} 90
http_requests_total{method="GET",route="/items",status="404"} 6
http_requests_total{method="POST",route="/items",status="500"} 4
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/items",le="0.1"} 50
http_request_duration_seconds_bucket{method="GET",route="/items",le="0.5"} 95
http_request_duration_seconds_bucket{method="GET",route="/items",le="1.0"} 100
http_request_duration_seconds_bucket{method="GET",route="/items",le="+Inf"} 100
http_request_duration_seconds_count{method="GET",route="/items"} 100`;

test('parseProm extracts name, labels, value and skips comments', () => {
  const s = parseProm(SAMPLE);
  const reqs = s.filter((x) => x.name === 'http_requests_total');
  assert.strictEqual(reqs.length, 3);
  assert.strictEqual(reqs[0].labels.status, '200');
  assert.strictEqual(reqs[0].value, 90);
});

test('errorRate counts only 5xx, as a percent', () => {
  // 4 of 100 are 5xx (the 404 must NOT count) -> 4%
  assert.strictEqual(errorRate(parseProm(SAMPLE)), 4);
});

test('errorRate returns null when there is no traffic', () => {
  assert.strictEqual(errorRate([]), null);
});

test('histogramP95 returns ms via bucket quantile', () => {
  // 0.95*100=95 crosses at le=0.5 bucket (cum 95); interpolates within (0.1,0.5]
  const p95 = histogramP95(parseProm(SAMPLE));
  assert.ok(p95 > 100 && p95 <= 500, `p95 ${p95} should be in (100,500] ms`);
});

test('histogramP95 returns null with no buckets', () => {
  assert.strictEqual(histogramP95([]), null);
});
