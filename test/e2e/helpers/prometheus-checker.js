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

module.exports = { queryPrometheus, assertMetricExists, isPrometheusUp };
