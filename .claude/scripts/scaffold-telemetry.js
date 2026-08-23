'use strict';

// Opt-in telemetry activation for a scaffolded project.
//
// Split out of scaffold-apply.js, which had grown to 314 lines against a 300
// cap. Self-contained: whether telemetry is on, and the env keys that turn it
// on in the copied settings. Nothing else in the apply path reads them.

const fs = require('fs');
const path = require('path');

function telemetryEnabled(profile, opts = {}) {
  if (typeof opts.telemetry === 'boolean') return opts.telemetry;
  return profile.telemetry === true;
}

// Telemetry env is opt-in. When enabled, these keys are injected into the copied
// settings, not the source. HARNESS_USER stays unset on purpose — record-run
// derives it from git user.name / the OS user.
const TELEMETRY_ENV = {
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
  OTEL_LOG_TOOL_DETAILS: '1',
  HARNESS_PUSHGATEWAY_URL: 'http://localhost:9091',
};

// Merge TELEMETRY_ENV into the copied settings files (interactive + headless).
// Existing env keys are preserved.
function enableTelemetry(target) {
  for (const file of ['settings.json', 'settings.auto.json']) {
    const p = path.join(target, '.claude', file);
    if (!fs.existsSync(p)) continue;
    const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
    settings.env = { ...(settings.env || {}), ...TELEMETRY_ENV };
    fs.writeFileSync(p, `${JSON.stringify(settings, null, 2)}\n`);
  }
}

module.exports = { telemetryEnabled, enableTelemetry, TELEMETRY_ENV };
