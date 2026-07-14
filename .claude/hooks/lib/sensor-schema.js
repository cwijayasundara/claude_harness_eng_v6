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

const BENIGN_VERDICTS = new Set(['pass', 'ok', 'no-baseline', 'no-snapshots', 'no-spec', 'unprovisioned', 'skipped', 'no-map']);
const FAIL_VERDICTS = new Set(['blocked', 'fail', 'breaking']);

function interpret(raw, kind) {
  if (!raw) return { present: false, pass: null, detail: null };
  if (kind === 'md_verdict') {
    const upper = String(raw).toUpperCase();
    if (/\bVERDICT\s*:\s*PASS\b/.test(upper) || (/\bPASS\b/.test(upper) && !/\bFAIL\b/.test(upper))) {
      return { present: true, pass: true, detail: null };
    }
    if (/\bVERDICT\s*:\s*FAIL\b/.test(upper) || /\bFAIL\b/.test(upper) || /\bBLOCK\b/.test(upper)) {
      return { present: true, pass: false, detail: null };
    }
    return { present: true, pass: null, detail: null };
  }
  if (kind === 'json_verdict') {
    const v = String(raw.verdict || raw.status || '').toLowerCase();
    if (BENIGN_VERDICTS.has(v)) return { present: true, pass: true, detail: v };
    if (FAIL_VERDICTS.has(v) || raw.pass === false) return { present: true, pass: false, detail: v || 'fail' };
    if (typeof raw.pass === 'boolean') return { present: true, pass: raw.pass, detail: v || null };
    return { present: true, pass: null, detail: v || null };
  }
  // json_pass
  if (typeof raw.pass === 'boolean') return { present: true, pass: raw.pass, detail: raw.summary || raw.note || null };
  if (raw.verdict) return interpret(raw, 'json_verdict');
  return { present: true, pass: null, detail: null };
}

function normalize(raw, kind) {
  const i = interpret(raw, kind);
  const base = applyDefaults({
    success: i.pass === true,
    summary: i.detail || (i.present ? '' : 'absent'),
    findings: i.pass === false ? [{ message: i.detail || 'fail', severity: 'error' }] : [],
  });
  base.extra = { present: i.present, detail: i.detail, pass: i.pass };
  return base;
}

module.exports = { SCHEMA_VERSION, applyDefaults, parseDefault, summaryFor, normalize };
