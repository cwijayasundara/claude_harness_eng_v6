'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readMarker(stateDir, name) {
  try {
    return fs.readFileSync(path.join(stateDir, name), 'utf8').trim() || null;
  } catch (_) {
    return null;
  }
}

function writeMarker(stateDir, name, value) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, name), `${value}\n`);
}

function ensureRunId(stateDir, sessionId) {
  const existing = readMarker(stateDir, 'current-run-id');
  if (existing) return existing;
  const runId = sessionId ? `run-${sessionId}` : `run-${crypto.randomUUID()}`;
  writeMarker(stateDir, 'current-run-id', runId);
  return runId;
}

function resolveTaskId(stateDir) {
  return readMarker(stateDir, 'current-task')
    || readMarker(stateDir, 'current-story')
    || readMarker(stateDir, 'current-group')
    || 'unassigned';
}

function readRiskTier(stateDir) {
  const explicit = readMarker(stateDir, 'current-risk-tier');
  if (explicit) return explicit;
  try {
    const envelope = JSON.parse(fs.readFileSync(path.join(stateDir, 'risk-envelope.json'), 'utf8'));
    return envelope.tier || 'unclassified';
  } catch (_) {
    return 'unclassified';
  }
}

function contextFields(stateDir, sessionId) {
  return {
    run_id: ensureRunId(stateDir, sessionId),
    task_id: resolveTaskId(stateDir),
    parent_run_id: readMarker(stateDir, 'parent-run-id'),
    risk_tier: readRiskTier(stateDir),
  };
}

module.exports = {
  contextFields,
  ensureRunId,
  readMarker,
  readRiskTier,
  resolveTaskId,
  writeMarker,
};
