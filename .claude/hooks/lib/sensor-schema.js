'use strict';

// Canonical sensor-result schema (sensors-cli parity). One shape every sensor
// can emit so a single parser reads them all. Pure module, no I/O.
//   { findings[], metrics[], guidance[], score{value,direction,description},
//     success, summary, extra{} }

const SCHEMA_VERSION = '1';

function asArray(v) { return Array.isArray(v) ? v : []; }
function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

function summaryFor(count) {
  if (count <= 0) return 'No issues';
  return `${count} issue${count === 1 ? '' : 's'}`;
}

// Fill absent/null fields per the sensors-cli default-parser contract.
function applyDefaults(obj) {
  const o = asObject(obj);
  const findings = asArray(o.findings);
  const metrics = asArray(o.metrics);
  const guidance = asArray(o.guidance);
  const extra = asObject(o.extra);
  const success = typeof o.success === 'boolean' ? o.success : findings.length === 0;
  const summary = typeof o.summary === 'string' && o.summary ? o.summary : summaryFor(findings.length);
  const inScore = asObject(o.score);
  const score = {
    value: typeof inScore.value === 'number' ? inScore.value : findings.length,
    direction: inScore.direction === 'more' ? 'more' : 'less',
    description: typeof inScore.description === 'string' && inScore.description
      ? inScore.description : 'Issues reported by tool',
  };
  return { findings, metrics, guidance, score, success, summary, extra, schema: SCHEMA_VERSION };
}

// Ingest a tool's stdout. Never throws: non-JSON becomes a failed result whose
// summary is the raw text, so a broken sensor is loud, not silent.
function parseDefault(stdout) {
  const text = String(stdout == null ? '' : stdout).trim();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {
    return applyDefaults({
      findings: [{ message: text || 'no output', severity: 'error' }],
      success: false,
      summary: text ? text.slice(0, 200) : 'no output',
      extra: { parseError: true },
    });
  }
  return applyDefaults(parsed);
}

module.exports = { SCHEMA_VERSION, applyDefaults, parseDefault, summaryFor };
