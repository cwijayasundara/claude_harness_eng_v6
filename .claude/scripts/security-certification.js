#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalize, contentHash, stampEnvelope } = require('../hooks/lib/task-envelope');
const { consumeCapability, signReceipt, verifyReceipt } = require('../hooks/lib/authority-receipt');
const { isWriteInScope, realResolve } = require('../hooks/lib/common');
const { machineryViolation } = require('../hooks/lib/trust-boundary');
const { classifyCommand } = require('../hooks/lib/runtime-command-policy');
const { policyHash, POLICY_REL } = require('./runtime-policy');

const CONFIG_REL = path.join('.claude', 'config', 'security-certification-profiles.json');
const RESULT_REL = path.join('.claude', 'certification', 'security-boundary.json');
const SUBJECTS = [
  '.claude/hooks/pre-bash-gate.js',
  '.claude/hooks/pre-write-gate.js',
  '.claude/hooks/lib/authority-receipt.js',
  '.claude/hooks/lib/runtime-command-policy.js',
  '.claude/hooks/lib/task-envelope.js',
  '.claude/hooks/lib/task-lifecycle.js',
  '.claude/scripts/runtime-policy.js',
  '.claude/scripts/security-certification.js',
  '.claude/scripts/autonomy-policy.js',
  '.claude/scripts/unattended-preflight.js',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function fileHash(root, rel) {
  return sha256(fs.readFileSync(path.join(root, rel)));
}
function integrity(result) {
  const body = { ...result };
  delete body.integrity;
  return sha256(canonicalize(body));
}
function receiptProbe(variant, now) {
  const trusted = crypto.generateKeyPairSync('ed25519');
  const attacker = crypto.generateKeyPairSync('ed25519');
  const envelope = stampEnvelope({
    schema_version: 1, task_id: 'CERT-TASK', risk_tier: 'R3',
    allowed_paths: ['src/**'], forbidden_actions: [], required_evidence: [],
    required_approvals: 0, budgets: { dimensions: [{ unit: 'agents', limit: 1 }] },
  });
  const body = {
    schema_version: 1, type: 'capability', receipt_id: 'probe',
    issuer: 'certifier', key_id: 'one',
    task_id: variant === 'wrong_task' ? 'OTHER' : envelope.task_id,
    task_envelope_hash: contentHash(envelope),
    issued_at: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + (variant === 'expired' ? -1000 : 60_000)).toISOString(),
    nonce: 'probe', actions: ['deploy'], approval_receipt_ids: [],
  };
  const receipt = signReceipt(body, variant === 'forged' ? attacker.privateKey : trusted.privateKey);
  const trust = { issuers: [{
    issuer: 'certifier', key_id: 'one',
    public_key_pem: trusted.publicKey.export({ type: 'spki', format: 'pem' }),
    allowed_types: ['capability'],
  }] };
  return verifyReceipt(receipt, { trust, envelope, type: 'capability', action: 'deploy', now }).valid;
}
function symlinkProbe() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-cert-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'security-cert-out-'));
  fs.symlinkSync(outside, path.join(root, 'escape'));
  return !isWriteInScope(root, realResolve(path.join(root, 'escape', 'secret.txt')));
}
function replayProbe() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-cert-replay-'));
  const cap = { receipt_id: 'single-use' };
  return consumeCapability(root, cap, 'deploy').consumed === true
    && consumeCapability(root, cap, 'deploy').consumed === false;
}
function runCase(root, policy, item, now) {
  let actual;
  if (item.kind === 'command') actual = classifyCommand(policy, item.command).finding || 'allowed';
  else if (item.kind === 'machinery') actual = machineryViolation(root, path.join(root, item.path)) ? 'blocked' : 'allowed';
  else if (item.kind === 'symlink_escape') actual = symlinkProbe() ? 'blocked' : 'allowed';
  else if (item.kind === 'receipt') actual = receiptProbe(item.variant, now) ? 'accepted' : 'rejected';
  else if (item.kind === 'replay') actual = replayProbe() ? 'rejected' : 'accepted';
  else actual = 'unknown-kind';
  return { id: item.id, kind: item.kind, expected: item.expect, actual, pass: actual === item.expect };
}
function loadProfile(root, name) {
  const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
  if (!config.profiles[name]) throw new Error(`unknown certification profile ${name}`);
  return config.profiles[name];
}
function certify(root, profileName = 'unattended-core', now = new Date(), write = true) {
  const profile = loadProfile(root, profileName);
  const policy = JSON.parse(fs.readFileSync(path.join(root, POLICY_REL), 'utf8'));
  const cases = profile.cases.map((item) => runCase(root, policy, item, now));
  const result = {
    schema_version: 1, profile: profileName, pass: cases.every((item) => item.pass),
    generated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + profile.ttl_hours * 3_600_000).toISOString(),
    policy_hash: policyHash(policy),
    subjects: Object.fromEntries(SUBJECTS.map((rel) => [rel, fileHash(root, rel)])),
    cases,
  };
  result.integrity = { algorithm: 'sha256', hash: integrity(result) };
  const out = path.join(root, RESULT_REL);
  if (write) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  }
  return { result, out };
}
function verifyCertification(root, profileName = 'unattended-core', now = new Date()) {
  let result;
  try { result = JSON.parse(fs.readFileSync(path.join(root, RESULT_REL), 'utf8')); } catch (_) {
    return { pass: false, failures: ['security-certification-missing-or-invalid'] };
  }
  const failures = [];
  if (result.profile !== profileName) failures.push('profile-mismatch');
  if (result.pass !== true || !Array.isArray(result.cases) || result.cases.some((item) => item.pass !== true)) failures.push('attack-case-failed');
  if (!result.integrity || result.integrity.hash !== integrity(result)) failures.push('integrity-mismatch');
  const expiresAt = Date.parse(result.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) failures.push('certification-expired');
  let policy;
  try { policy = JSON.parse(fs.readFileSync(path.join(root, POLICY_REL), 'utf8')); } catch (_) { policy = null; }
  if (!policy || result.policy_hash !== policyHash(policy)) failures.push('policy-drift');
  if (policy) {
    const profile = loadProfile(root, profileName);
    const liveCases = profile.cases.map((item) => runCase(root, policy, item, now));
    if (liveCases.some((item) => !item.pass)) failures.push('live-attack-probe-failed');
  }
  for (const rel of SUBJECTS) {
    try { if (!result.subjects || result.subjects[rel] !== fileHash(root, rel)) failures.push(`subject-drift:${rel}`); }
    catch (_) { failures.push(`subject-missing:${rel}`); }
  }
  return { pass: failures.length === 0, failures, result };
}
function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const profileIndex = argv.indexOf('--profile');
  const profile = profileIndex === -1 ? 'unattended-core' : argv[profileIndex + 1];
  try {
    if (argv[0] === 'run') {
      const output = certify(root, profile);
      process.stdout.write(`security-certification: ${output.result.pass ? 'PASS' : 'FAIL'} profile=${profile} → ${output.out}\n`);
      if (!output.result.pass) process.exitCode = 1;
      return;
    }
    if (argv[0] === 'verify') {
      const output = verifyCertification(root, profile);
      process.stdout.write(`security-certification: ${output.pass ? 'VALID' : 'INVALID'} profile=${profile}\n`);
      if (!output.pass) {
        process.stderr.write(`${output.failures.join('\n')}\n`);
        process.exitCode = 1;
      }
      return;
    }
    throw new Error('usage: security-certification.js run|verify [--profile unattended-core]');
  } catch (err) {
    process.stderr.write(`security-certification: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  CONFIG_REL, RESULT_REL, SUBJECTS, certify, integrity, receiptProbe,
  replayProbe, runCase, symlinkProbe, verifyCertification,
};
if (require.main === module) main();
