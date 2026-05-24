'use strict';

const http = require('http');

const GRAFANA_URL = process.env.GRAFANA_URL || 'http://localhost:3001';

function grafanaGet(apiPath) {
  return new Promise((resolve, reject) => {
    const url = GRAFANA_URL + apiPath;
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, data: body }); }
      });
    }).on('error', reject);
  });
}

async function isGrafanaUp() {
  try {
    const { status } = await grafanaGet('/api/health');
    return status === 200;
  } catch (_) {
    return false;
  }
}

async function getDashboard(uid) {
  return grafanaGet('/api/dashboards/uid/' + uid);
}

async function listDashboards() {
  return grafanaGet('/api/search?type=dash-db');
}

module.exports = { grafanaGet, isGrafanaUp, getDashboard, listDashboards };
