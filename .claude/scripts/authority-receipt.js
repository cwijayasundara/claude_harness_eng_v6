#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadEnvelope, contentHash } = require('../hooks/lib/task-envelope');
const { findCapability, loadTrust, signReceipt, verifyReceipt } = require('../hooks/lib/authority-receipt');

function values(argv, flag) {
  const found = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === flag && argv[i + 1]) found.push(argv[++i]);
  return found;
}
function value(argv, flag, fallback = null) {
  const found = values(argv, flag);
  return found.length ? found[found.length - 1] : fallback;
}

function baseReceipt(type, opts, envelope, now = new Date()) {
  const ttl = Number(opts.ttlMinutes || 15);
  return {
    schema_version: 1,
    type,
    receipt_id: opts.receiptId || crypto.randomUUID(),
    issuer: opts.issuer,
    key_id: opts.keyId,
    task_id: envelope.task_id,
    task_envelope_hash: contentHash(envelope),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 60_000).toISOString(),
    nonce: crypto.randomBytes(24).toString('base64url'),
  };
}

function issue(root, command, argv) {
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') throw new Error(`task envelope is ${loaded.state}`);
  const privateKeyFile = value(argv, '--private-key');
  const issuer = value(argv, '--issuer');
  const keyId = value(argv, '--key-id');
  if (!privateKeyFile || !issuer || !keyId) throw new Error('--private-key, --issuer, and --key-id are required');
  const opts = {
    issuer, keyId,
    receiptId: value(argv, '--receipt-id'),
    ttlMinutes: value(argv, '--ttl-minutes', 15),
  };
  const type = command === 'issue-approval' ? 'human_approval'
    : command === 'issue-execution' ? 'human_execution'
      : command === 'issue-runtime' ? 'runtime_attestation' : 'capability';
  let body = baseReceipt(type, opts, loaded.envelope);
  let kind;
  if (command === 'issue-runtime') {
    const policyHash = value(argv, '--policy-hash');
    const runtimeId = value(argv, '--runtime-id');
    if (!policyHash || !runtimeId) throw new Error('--policy-hash and --runtime-id are required');
    body = {
      ...body, policy_hash: policyHash, runtime_id: runtimeId,
      network_enforced: true, credential_brokered: true,
      read_only_paths: values(argv, '--read-only'),
    };
    kind = 'runtime';
  } else if (command === 'issue-approval' || command === 'issue-execution') {
    const approverId = value(argv, '--approver');
    if (!approverId) throw new Error('--approver is required');
    body = { ...body, approver_id: approverId };
    if (command === 'issue-approval') {
      body = { ...body, decision: 'approved' };
      kind = 'approvals';
    } else {
      const executionRef = value(argv, '--execution-ref');
      if (!executionRef) throw new Error('--execution-ref is required');
      body = { ...body, execution_ref: executionRef };
      kind = 'executions';
    }
  } else {
    const actions = values(argv, '--action');
    if (!actions.length) throw new Error('at least one --action is required');
    body = { ...body, actions, approval_receipt_ids: values(argv, '--approval') };
    kind = 'capabilities';
  }
  const signed = signReceipt(body, fs.readFileSync(privateKeyFile, 'utf8'));
  const out = value(argv, '--out', path.join(root, '.claude', 'authority', kind, `${signed.receipt_id}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o600 });
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const root = value(argv, '--root', process.env.CLAUDE_PROJECT_DIR || process.cwd());
  try {
    if (['issue-approval', 'issue-capability', 'issue-execution', 'issue-runtime'].includes(command)) {
      process.stdout.write(`authority-receipt: ISSUED ${issue(root, command, argv)}\n`);
      return;
    }
    if (command === 'verify-capability') {
      const loaded = loadEnvelope(root);
      if (loaded.state !== 'valid') throw new Error(`task envelope is ${loaded.state}`);
      const action = value(argv, '--action');
      const checked = findCapability(root, loaded.envelope, action);
      if (!checked.valid) throw new Error(checked.errors.join('; '));
      process.stdout.write(`authority-receipt: VALID capability=${checked.receipt.receipt_id} action=${action}\n`);
      return;
    }
    if (command === 'verify-receipt') {
      const loaded = loadEnvelope(root);
      const trust = loadTrust(root);
      const receipt = JSON.parse(fs.readFileSync(value(argv, '--file'), 'utf8'));
      const checked = verifyReceipt(receipt, { trust, envelope: loaded.envelope, type: receipt.type });
      if (!checked.valid) throw new Error(checked.errors.join('; '));
      process.stdout.write(`authority-receipt: VALID receipt=${receipt.receipt_id}\n`);
      return;
    }
    throw new Error('usage: authority-receipt.js issue-approval|issue-capability|issue-execution|issue-runtime|verify-capability|verify-receipt');
  } catch (err) {
    process.stderr.write(`authority-receipt: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { baseReceipt, issue, value, values };
if (require.main === module) main();
