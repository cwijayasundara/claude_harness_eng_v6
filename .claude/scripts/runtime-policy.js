#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalize, loadEnvelope } = require('../hooks/lib/task-envelope');
const { loadTrust, readReceipts, verifyReceipt } = require('../hooks/lib/authority-receipt');

const POLICY_REL = path.join('.claude', 'unattended-policy.json');

function policyHash(policy) {
  return crypto.createHash('sha256').update(canonicalize(policy)).digest('hex');
}

function verifyRuntime(root, now = new Date()) {
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') return { pass: false, failures: [`task-envelope:${loaded.state}`] };
  let policy;
  try { policy = JSON.parse(fs.readFileSync(path.join(root, POLICY_REL), 'utf8')); } catch (_) {
    return { pass: false, failures: ['runtime-policy-missing-or-invalid'] };
  }
  const trust = loadTrust(root);
  if (trust.state !== 'valid') return { pass: false, failures: [`trust-registry:${trust.state}`] };
  const requiredPaths = policy.read_only_paths || [];
  const hash = policyHash(policy);
  for (const { receipt } of readReceipts(root, 'runtime')) {
    const checked = verifyReceipt(receipt, {
      trust, envelope: loaded.envelope, type: 'runtime_attestation', now,
    });
    if (!checked.valid || receipt.policy_hash !== hash) continue;
    if (requiredPaths.some((item) => !receipt.read_only_paths.includes(item))) continue;
    return { pass: true, runtime_id: receipt.runtime_id, policy_hash: hash, receipt_id: receipt.receipt_id };
  }
  return { pass: false, failures: ['no valid runtime attestation matches policy and read-only paths'], policy_hash: hash };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = verifyRuntime(root);
  process.stdout.write(`runtime-policy: ${result.pass ? 'PASS' : 'BLOCK'}${result.runtime_id ? ` runtime=${result.runtime_id}` : ''}\n`);
  if (!result.pass) {
    process.stderr.write(`${result.failures.join('\n')}\n`);
    process.exitCode = 1;
  }
}

module.exports = { POLICY_REL, policyHash, verifyRuntime };
if (require.main === module) main();
