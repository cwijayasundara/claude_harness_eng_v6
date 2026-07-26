'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
const { signReceipt } = require('../.claude/hooks/lib/authority-receipt');
const { finalize } = require('../.claude/scripts/finalize-task-evidence');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-evidence-'));
  const pair = crypto.generateKeyPairSync('ed25519');
  const created = new Date(Date.now() - 10_000).toISOString();
  const envelope = stampEnvelope({
    schema_version: 1, task_id: 'T-2', risk_tier: 'R1',
    intent_hash: 'a'.repeat(64), risk_envelope_hash: 'b'.repeat(64),
    allowed_paths: ['src/**'], forbidden_actions: ['merge'],
    required_evidence: ['unit', 'independent_review'], required_approvals: 1,
    budgets: { warn_at_pct: 80, dimensions: [{ unit: 'agents', limit: 2 }] },
    stopping_conditions: ['gate_pass'], created_at: created,
  });
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(envelope));
  fs.writeFileSync(path.join(root, '.claude', 'state', 'gate-receipt.json'), JSON.stringify({ pass: true }));
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'reviews', 'gate-checks.json'), JSON.stringify({ pass: true }));
  fs.writeFileSync(path.join(root, 'specs', 'reviews', 'code-review-verdict.json'), JSON.stringify({ pass: true }));
  fs.mkdirSync(path.join(root, '.claude', 'trust'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'trust', 'issuers.json'), JSON.stringify({
    schema_version: 1, issuers: [{
      issuer: 'review-board', key_id: 'one',
      public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      allowed_types: ['human_approval', 'human_execution'],
    }],
  }));
  const approval = signReceipt({
    schema_version: 1, type: 'human_approval', receipt_id: 'approval-1',
    issuer: 'review-board', key_id: 'one', task_id: envelope.task_id,
    task_envelope_hash: envelope.integrity.hash, approver_id: 'alice',
    decision: 'approved',
    issued_at: new Date(Date.now() - 5_000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(), nonce: 'unique',
  }, pair.privateKey);
  const dir = path.join(root, '.claude', 'authority', 'approvals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'approval-1.json'), JSON.stringify(approval));
  return { root };
}

test('finalizer binds fresh passing evidence and signed approvals to task and run', () => {
  const { root } = setup();
  const result = finalize(root);
  assert.strictEqual(result.receipt.pass, true, JSON.stringify(result.receipt.findings));
  assert.deepStrictEqual(result.receipt.distinct_approvers, ['alice']);
  assert.match(result.receipt.task_envelope_hash, /^[a-f0-9]{64}$/);
});

test('finalizer fails closed when required evidence is missing', () => {
  const { root } = setup();
  fs.unlinkSync(path.join(root, 'specs', 'reviews', 'code-review-verdict.json'));
  const result = finalize(root);
  assert.strictEqual(result.receipt.pass, false);
  assert.ok(result.receipt.findings.missing.includes('independent_review'));
});
