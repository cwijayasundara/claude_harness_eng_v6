'use strict';

// Pure logic for the computational security sensors (gap G3): normalize the
// JSON each tool emits into one finding shape, classify severity, filter to a
// threshold, and render findings LLM-legibly. The CLI orchestrator
// (.claude/scripts/security-scan.js) handles tool detection and invocation;
// everything testable lives here. Reuses the existing regex secret scanner and
// the review-policy boundary classifier so we have one source of truth each.

const { scanSecrets } = require('./secrets');
const { touchesSecurityBoundary } = require('./review-policy');

// One ordering for every tool's severity vocabulary. Higher = worse.
const SEVERITY_RANK = {
  info: 0, note: 0,
  low: 1, warning: 2, moderate: 2, medium: 2,
  high: 3, error: 3,
  critical: 4,
};

function severityRank(s) {
  const r = SEVERITY_RANK[String(s || '').toLowerCase()];
  return r === undefined ? 0 : r;
}

// gitleaks detect --report-format json -> array of findings.
function normalizeGitleaks(json) {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((f) => ({
    tool: 'gitleaks',
    severity: 'critical',
    file: f.File || f.file || null,
    line: f.StartLine || f.startLine || null,
    rule: f.RuleID || f.ruleID || 'secret',
    message: f.Description || 'hardcoded secret detected',
  }));
}

// semgrep --json -> { results: [{ check_id, path, start:{line}, extra:{severity,message} }] }
function normalizeSemgrep(json) {
  const results = (json && json.results) || [];
  return results.map((r) => ({
    tool: 'semgrep',
    severity: (r.extra && r.extra.severity ? String(r.extra.severity) : 'warning').toLowerCase(),
    file: r.path || null,
    line: (r.start && r.start.line) || null,
    rule: r.check_id || 'semgrep-rule',
    message: (r.extra && r.extra.message) || 'SAST finding',
  }));
}

// npm audit --json (npm v7+) -> { vulnerabilities: { <pkg>: { name, severity } } }
function normalizeNpmAudit(json) {
  const vulns = (json && json.vulnerabilities) || {};
  return Object.values(vulns).map((v) => ({
    tool: 'npm-audit',
    severity: String(v.severity || 'low').toLowerCase(),
    file: 'package.json',
    line: null,
    rule: v.name || 'dependency',
    message: `${v.name || 'a dependency'} has a ${v.severity || 'known'} vulnerability`,
  }));
}

// pip-audit --format=json -> { dependencies: [{ name, version, vulns:[{id}] }] } or a bare array.
function normalizePipAudit(json) {
  const deps = Array.isArray(json) ? json : (json && json.dependencies) || [];
  const out = [];
  for (const d of deps) {
    for (const v of d.vulns || []) {
      out.push({
        tool: 'pip-audit',
        severity: 'high', // pip-audit reports a CVE id without a severity grade; treat presence as high
        file: d.name || 'requirements',
        line: null,
        rule: v.id || d.name || 'dependency',
        message: `${d.name || 'a dependency'} ${d.version || ''} is affected by ${v.id || 'a known CVE'}`.trim(),
      });
    }
  }
  return out;
}

// Always-available secrets tier: reuse the regex scanner over file contents.
// readFile is injected so this stays pure and testable.
function baselineSecretFindings(files, readFile) {
  const out = [];
  for (const file of files) {
    let content;
    try { content = readFile(file); } catch (_) { continue; }
    for (const f of scanSecrets(content)) {
      out.push({
        tool: 'secrets-regex', severity: 'critical', file, line: null,
        rule: f.label, message: `possible ${f.label} (${f.value})`,
      });
    }
  }
  return out;
}

function boundaryFiles(files) {
  return files.filter(touchesSecurityBoundary);
}

// Keep only findings at or above the threshold severity.
function summarize(findings, threshold) {
  const min = severityRank(threshold);
  const blocking = findings.filter((f) => severityRank(f.severity) >= min);
  return { total: findings.length, blocking: blocking.length, findings: blocking };
}

// LLM-legible: each line says what, where, and carries a remediation hint.
function renderFindings(findings) {
  if (!findings.length) return 'No security findings at or above threshold.';
  return findings
    .map((f) => `  [${f.severity}] ${f.tool}:${f.rule}  ${f.file || '?'}${f.line ? ':' + f.line : ''}\n    ${f.message}`)
    .join('\n');
}

module.exports = {
  severityRank,
  normalizeGitleaks,
  normalizeSemgrep,
  normalizeNpmAudit,
  normalizePipAudit,
  baselineSecretFindings,
  boundaryFiles,
  summarize,
  renderFindings,
};
