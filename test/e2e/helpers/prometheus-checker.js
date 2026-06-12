'use strict';

const http = require('http');

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';

function queryPrometheus(query) {
  return new Promise((resolve, reject) => {
    const url = PROMETHEUS_URL + '/api/v1/query?query=' + encodeURIComponent(query);
    http.get(url, { agent: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Prometheus JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function assertMetricExists(query) {
  const data = await queryPrometheus(query);
  if (data.status !== 'success') {
    return { exists: false, reason: 'Query failed: ' + (data.error || 'unknown') };
  }
  const hasResults = data.data && data.data.result && data.data.result.length > 0;
  return { exists: hasResults, resultCount: hasResults ? data.data.result.length : 0 };
}

function isPrometheusUp() {
  return new Promise((resolve) => {
    http.get(PROMETHEUS_URL + '/-/healthy', (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

// Poll Prometheus for a metric until it appears or timeout is reached.
// intervalMs: how often to check (default 5000). timeoutMs: max wait (default 60000).
function pollMetric(query, intervalMs, timeoutMs) {
  intervalMs = intervalMs || 5000;
  timeoutMs = timeoutMs || 60000;
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      assertMetricExists(query).then((result) => {
        if (result.exists) return resolve(result);
        if (Date.now() >= deadline) return resolve(result);
        setTimeout(attempt, intervalMs);
      }).catch(() => {
        if (Date.now() >= deadline) return resolve({ exists: false, resultCount: 0 });
        setTimeout(attempt, intervalMs);
      });
    }
    attempt();
  });
}

module.exports = { queryPrometheus, assertMetricExists, isPrometheusUp, pollMetric };
