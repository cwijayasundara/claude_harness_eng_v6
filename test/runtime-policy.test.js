'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
const { signReceipt } = require('../.claude/hooks/lib/authority-receipt');
const { policyHash, verifyRuntime } = require('../.claude/scripts/runtime-policy');
const { createRequest } = require('../.claude/scripts/credential-request');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-policy-'));
  const pair = crypto.generateKeyPairSync('ed25519');
  const envelope = stampEnvelope({
    schema_version: 1, task_id: 'RUN-1', risk_tier: 'R2',
    allowed_paths: ['src/**'], forbidden_actions: [], required_evidence: [],
    required_approvals: 0, budgets: { dimensions: [{ unit: 'agents', limit: 1 }] },
  });
  const policy = {
    schema_version: 1, network: { mode: 'deny-by-default', allowed_domains: [] },
    read_only_paths: ['.claude/hooks', '.claude/trust'], broker_only_commands: [],
    credentials: { github_release: { allowed_commands: ['gh'] } },
  };
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(envelope));
  fs.writeFileSync(path.join(root, '.claude', 'unattended-policy.json'), JSON.stringify(policy));
  fs.mkdirSync(path.join(root, '.claude', 'trust'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'trust', 'issuers.json'), JSON.stringify({
    schema_version: 1, issuers: [{
      issuer: 'runtime', key_id: 'one',
      public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      allowed_types: ['runtime_attestation', 'capability'],
    }],
  }));
  const receipt = signReceipt({
    schema_version: 1, type: 'runtime_attestation', receipt_id: 'runtime-1',
    issuer: 'runtime', key_id: 'one', task_id: envelope.task_id,
    task_envelope_hash: envelope.integrity.hash,
    issued_at: '2026-07-26T12:00:00Z', expires_at: '2026-07-26T13:00:00Z',
    nonce: 'one', runtime_id: 'container-1', policy_hash: policyHash(policy),
    network_enforced: true, credential_brokered: true, read_only_paths: policy.read_only_paths,
  }, pair.privateKey);
  const dir = path.join(root, '.claude', 'authority', 'runtime');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime-1.json'), JSON.stringify(receipt));
  const capability = signReceipt({
    schema_version: 1, type: 'capability', receipt_id: 'credential-cap',
    issuer: 'runtime', key_id: 'one', task_id: envelope.task_id,
    task_envelope_hash: envelope.integrity.hash,
    issued_at: '2026-07-26T12:00:00Z', expires_at: '2026-07-26T13:00:00Z',
    nonce: 'two', actions: ['credential:github_release'], approval_receipt_ids: [],
  }, pair.privateKey);
  const capDir = path.join(root, '.claude', 'authority', 'capabilities');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'credential-cap.json'), JSON.stringify(capability));
  return { root, policy };
}

test('runtime verification binds external enforcement to the exact policy hash', () => {
  const { root, policy } = fixture();
  assert.strictEqual(verifyRuntime(root, new Date('2026-07-26T12:10:00Z')).pass, true);
  policy.network.allowed_domains.push('example.com');
  fs.writeFileSync(path.join(root, '.claude', 'unattended-policy.json'), JSON.stringify(policy));
  assert.strictEqual(verifyRuntime(root, new Date('2026-07-26T12:10:00Z')).pass, false);
});

test('credential broker emits a secret-free external execution request and consumes authority', () => {
  const { root } = fixture();
  const first = createRequest(root, {
    credentialId: 'github_release', command: 'gh', args: ['release', 'list'],
    now: new Date('2026-07-26T12:10:00Z'),
  });
  assert.strictEqual(first.request.credential_id, 'github_release');
  assert.strictEqual(Object.hasOwn(first.request, 'secret'), false);
  assert.throws(() => createRequest(root, {
    credentialId: 'github_release', command: 'gh', args: [],
    now: new Date('2026-07-26T12:11:00Z'),
  }), /already consumed|no valid/);
});
