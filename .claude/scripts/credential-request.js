#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalize, contentHash, loadEnvelope } = require('../hooks/lib/task-envelope');
const { consumeCapability, findCapability } = require('../hooks/lib/authority-receipt');
const { policyHash, POLICY_REL, verifyRuntime } = require('./runtime-policy');

function value(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

function createRequest(root, { credentialId, command, args = [], now = new Date() }) {
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') throw new Error(`task envelope is ${loaded.state}`);
  const runtime = verifyRuntime(root, now);
  if (!runtime.pass) throw new Error(runtime.failures.join('; '));
  const policy = JSON.parse(fs.readFileSync(path.join(root, POLICY_REL), 'utf8'));
  const credential = policy.credentials && policy.credentials[credentialId];
  if (!credential) throw new Error(`credential ${credentialId} is not declared`);
  if (!Array.isArray(credential.allowed_commands) || !credential.allowed_commands.includes(command)) {
    throw new Error(`command ${command} is not allowed for credential ${credentialId}`);
  }
  const authority = findCapability(root, loaded.envelope, `credential:${credentialId}`, now);
  if (!authority.valid) throw new Error(authority.errors.join('; '));
  const consumed = consumeCapability(root, authority.receipt, `credential:${credentialId}`, now);
  if (!consumed.consumed) throw new Error(consumed.error);
  const body = {
    schema_version: 1, request_id: crypto.randomUUID(), task_id: loaded.envelope.task_id,
    task_envelope_hash: contentHash(loaded.envelope), runtime_id: runtime.runtime_id,
    runtime_policy_hash: policyHash(policy), credential_id: credentialId,
    command, args, requested_at: now.toISOString(), capability_receipt_id: authority.receipt.receipt_id,
  };
  body.integrity = crypto.createHash('sha256').update(canonicalize(body)).digest('hex');
  const out = path.join(root, '.claude', 'state', 'credential-requests', `${body.request_id}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  return { request: body, out };
}

function main() {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] !== 'create') throw new Error('usage: credential-request.js create --credential ID --command BIN [--arg VALUE]');
    const args = [];
    for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--arg' && argv[i + 1]) args.push(argv[++i]);
    const result = createRequest(process.env.CLAUDE_PROJECT_DIR || process.cwd(), {
      credentialId: value(argv, '--credential'), command: value(argv, '--command'), args,
    });
    process.stdout.write(`credential-request: QUEUED ${result.out}\n`);
  } catch (err) {
    process.stderr.write(`credential-request: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { createRequest, value };
if (require.main === module) main();
