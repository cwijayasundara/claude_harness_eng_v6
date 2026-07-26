#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadEnvelope, contentHash, stampEnvelope } = require('../hooks/lib/task-envelope');
const { loadTrust, readReceipts, validApprovals, verifyReceipt } = require('../hooks/lib/authority-receipt');
const { readMarker } = require('../hooks/lib/run-context');
const { normalize } = require('../hooks/lib/sensor-schema');

const EVIDENCE = Object.freeze({
  unit: ['specs/reviews/gate-checks.json'],
  acceptance: ['specs/reviews/gate-checks.json'],
  integration: ['specs/reviews/gate-checks.json'],
  independent_review: ['specs/reviews/code-review-verdict.json'],
  sast: ['specs/reviews/security-scan.json'],
  dependency_scan: ['specs/reviews/security-scan.json'],
  security_review: ['specs/reviews/security-verdict.json'],
  threat_model: [
    'specs/security/threat-model.md',
    'specs/design/threat-model.md',
    '.claude/claude-security-guidance.md',
  ],
});

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function jsonPass(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalize(value, 'json_pass').extra.pass === true
      || normalize(value, 'json_verdict').extra.pass === true;
  } catch (_) {
    return false;
  }
}

function selectEvidence(root, kind, createdAt) {
  const candidates = EVIDENCE[kind] || [];
  for (const rel of candidates) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const current = fs.statSync(file).mtimeMs >= Date.parse(createdAt);
    const pass = rel.endsWith('.md') || jsonPass(file);
    return { kind, path: rel, sha256: sha256File(file), current, pass };
  }
  return { kind, path: null, sha256: null, current: false, pass: false };
}

function finalize(root, now = new Date()) {
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') throw new Error(`task envelope is ${loaded.state}: ${loaded.errors.join('; ')}`);
  const envelope = loaded.envelope;
  const requiresHumanExecution = envelope.required_evidence.includes('human_execution');
  const required = envelope.required_evidence.filter((kind) => kind !== 'human_execution');
  const evidence = required.map((kind) => selectEvidence(root, kind, envelope.created_at));
  const trust = loadTrust(root);
  const approvals = trust.state === 'valid' ? validApprovals(root, envelope, trust, now) : [];
  const approvers = [...new Set(approvals.map(({ receipt }) => receipt.approver_id))];
  const missing = evidence.filter((item) => !item.path).map((item) => item.kind);
  const stale = evidence.filter((item) => item.path && !item.current).map((item) => item.kind);
  const failed = evidence.filter((item) => item.path && !item.pass).map((item) => item.kind);
  if (approvers.length < envelope.required_approvals) {
    missing.push(`signed_approvals:${approvers.length}/${envelope.required_approvals}`);
  }
  const executions = trust.state === 'valid'
    ? readReceipts(root, 'executions').filter(({ receipt }) =>
      verifyReceipt(receipt, { trust, envelope, type: 'human_execution', now }).valid)
    : [];
  if (requiresHumanExecution && executions.length === 0) missing.push('human_execution');
  const gateFile = path.join(root, '.claude', 'state', 'gate-receipt.json');
  const gate = fs.existsSync(gateFile) && jsonPass(gateFile);
  if (!gate) failed.push('gate_pass');
  const receipt = stampEnvelope({
    schema_version: 1,
    type: 'task_completion',
    task_id: envelope.task_id,
    task_envelope_hash: contentHash(envelope),
    run_id: readMarker(path.join(root, '.claude', 'state'), 'current-run-id') || 'unassigned',
    generated_at: now.toISOString(),
    pass: missing.length === 0 && stale.length === 0 && failed.length === 0,
    evidence,
    approval_receipt_ids: approvals.map(({ receipt: item }) => item.receipt_id),
    execution_receipt_ids: executions.map(({ receipt: item }) => item.receipt_id),
    distinct_approvers: approvers,
    findings: { missing, stale, failed },
  });
  const out = path.join(root, '.claude', 'state', 'task-completion-receipt.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, out };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const result = finalize(root);
    process.stdout.write(`task-evidence: ${result.receipt.pass ? 'PASS' : 'BLOCK'} task=${result.receipt.task_id} → ${result.out}\n`);
    if (!result.receipt.pass) {
      process.stderr.write(`task-evidence: ${JSON.stringify(result.receipt.findings)}\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`task-evidence: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { EVIDENCE, finalize, jsonPass, selectEvidence, sha256File };
if (require.main === module) main();
