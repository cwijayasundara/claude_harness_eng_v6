'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENVELOPE_REL = path.join('.claude', 'state', 'task-envelope.json');
const FORBIDDEN_ACTIONS = Object.freeze({
  merge: /\b(?:git\s+merge|gh\s+pr\s+merge)\b/i,
  deploy: /\b(?:kubectl\s+(?:apply|delete|rollout)|terraform\s+apply|vercel\s+deploy|aws\s+.*deploy|gcloud\s+.*deploy|npm\s+run\s+deploy)\b/i,
  modify_branch_protection: /\bgh\s+api\b.*(?:rulesets|branch(?:es)?\/.*protection)/i,
  execute_production_change: /\b(?:prod(?:uction)?)[-_\s]*(?:migrate|deploy|apply|delete|write)\b/i,
});

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(envelope) {
  const body = { ...envelope };
  delete body.integrity;
  return crypto.createHash('sha256').update(canonicalize(body)).digest('hex');
}

function stampEnvelope(envelope) {
  return { ...envelope, integrity: { algorithm: 'sha256', hash: contentHash(envelope) } };
}

function validateEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object') return ['envelope must be an object'];
  if (![1, 2].includes(envelope.schema_version)) errors.push('schema_version must be 1 or 2');
  if (!envelope.task_id) errors.push('task_id is required');
  if (!/^R[0-4]$/.test(envelope.risk_tier || '')) errors.push('risk_tier must be R0-R4');
  if (!Array.isArray(envelope.allowed_paths) || envelope.allowed_paths.length === 0) {
    errors.push('allowed_paths must contain at least one explicit path or glob');
  }
  if (!Array.isArray(envelope.forbidden_actions)) errors.push('forbidden_actions must be an array');
  if (!Array.isArray(envelope.required_evidence)) errors.push('required_evidence must be an array');
  if (!Number.isInteger(envelope.required_approvals) || envelope.required_approvals < 0) {
    errors.push('required_approvals must be a non-negative integer');
  }
  if (!envelope.budgets || !Array.isArray(envelope.budgets.dimensions)) errors.push('budgets.dimensions is required');
  if (!envelope.integrity || envelope.integrity.algorithm !== 'sha256') errors.push('sha256 integrity is required');
  else if (envelope.integrity.hash !== contentHash(envelope)) errors.push('integrity hash mismatch');
  if (envelope.schema_version === 2) {
    if (!Number.isInteger(envelope.version) || envelope.version < 1) errors.push('version must be a positive integer');
    if (!Number.isFinite(Date.parse(envelope.expires_at))) errors.push('expires_at must be a date-time');
    if (!Array.isArray(envelope.amendments)) errors.push('amendments must be an array');
  }
  return errors;
}

function loadEnvelope(projectDir) {
  const file = path.join(projectDir, ENVELOPE_REL);
  if (!fs.existsSync(file)) return { state: 'absent', file, envelope: null, errors: [] };
  try {
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validateEnvelope(envelope);
    return { state: errors.length ? 'invalid' : 'valid', file, envelope, errors };
  } catch (err) {
    return { state: 'invalid', file, envelope: null, errors: [`unparseable: ${err.message}`] };
  }
}

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function pathMatches(pattern, candidate) {
  const wanted = normalizeRel(pattern);
  const rel = normalizeRel(candidate);
  if (wanted === rel) return true;
  if (wanted.endsWith('/**')) {
    const prefix = wanted.slice(0, -3).replace(/\/$/, '');
    return rel === prefix || rel.startsWith(`${prefix}/`);
  }
  if (wanted.endsWith('/*')) {
    const prefix = wanted.slice(0, -2).replace(/\/$/, '');
    if (!rel.startsWith(`${prefix}/`)) return false;
    return !rel.slice(prefix.length + 1).includes('/');
  }
  return false;
}

function pathAllowed(envelope, projectDir, target) {
  const rel = normalizeRel(path.relative(projectDir, target));
  return (envelope.allowed_paths || []).some((pattern) => pathMatches(pattern, rel));
}

function forbiddenAction(envelope, command) {
  for (const action of envelope.forbidden_actions || []) {
    const pattern = FORBIDDEN_ACTIONS[action];
    if (pattern && pattern.test(command)) return action;
  }
  return null;
}

module.exports = {
  ENVELOPE_REL,
  FORBIDDEN_ACTIONS,
  canonicalize,
  contentHash,
  forbiddenAction,
  loadEnvelope,
  pathAllowed,
  pathMatches,
  stampEnvelope,
  validateEnvelope,
};
