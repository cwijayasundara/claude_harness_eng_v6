'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { test } = require('node:test');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
const { appendEvent, lifecycleStatus, readLedger } = require('../.claude/hooks/lib/task-lifecycle');
const { signReceipt } = require('../.claude/hooks/lib/authority-receipt');
const { amend } = require('../.claude/scripts/task-envelope');

function envelope(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return stampEnvelope({
    schema_version: 2, version: 1, task_id: 'LIFE-1', risk_tier: 'R1',
    intent_hash: 'a'.repeat(64), risk_envelope_hash: 'b'.repeat(64),
    allowed_paths: ['src/**'], forbidden_actions: [], required_evidence: [],
    required_approvals: 0,
    budgets: { warn_at_pct: 80, dimensions: [{ unit: 'agents', limit: 1 }] },
    stopping_conditions: ['gate_pass'], created_at: new Date().toISOString(),
    expires_at: expiresAt, previous_envelope_hash: null, amendments: [],
  });
}

test('lifecycle requires activation and becomes terminal after completion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-life-'));
  const task = envelope();
  appendEvent(root, task, 'created');
  assert.strictEqual(lifecycleStatus(root, task).allowed, false);
  appendEvent(root, task, 'active');
  assert.strictEqual(lifecycleStatus(root, task).allowed, true);
  appendEvent(root, task, 'completed');
  assert.strictEqual(lifecycleStatus(root, task).state, 'completed');
  assert.strictEqual(lifecycleStatus(root, task).allowed, false);
});

test('lifecycle detects expiry and hash-chain corruption', () => {
  const expired = envelope(new Date(Date.now() - 1000).toISOString());
  assert.strictEqual(lifecycleStatus(fs.mkdtempSync(path.join(os.tmpdir(), 'task-exp-')), expired).state, 'expired');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-chain-'));
  const task = envelope();
  appendEvent(root, task, 'created');
  const file = path.join(root, '.claude', 'state', 'task-lifecycle.jsonl');
  fs.appendFileSync(file, '{"sequence":2,"state":"active"}\n');
  assert.strictEqual(readLedger(root).state, 'invalid');
});

test('scope amendment requires and consumes signed authority while preserving the hash chain', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-amend-'));
  const task = envelope('2026-07-26T14:00:00Z');
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(task));
  appendEvent(root, task, 'created', {}, new Date('2026-07-26T12:00:00Z'));
  appendEvent(root, task, 'active', {}, new Date('2026-07-26T12:01:00Z'));
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(root, '.claude', 'trust'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'trust', 'issuers.json'), JSON.stringify({
    schema_version: 1, issuers: [{
      issuer: 'change-board', key_id: 'one',
      public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      allowed_types: ['capability'],
    }],
  }));
  const receipt = signReceipt({
    schema_version: 1, type: 'capability', receipt_id: 'amend-once',
    issuer: 'change-board', key_id: 'one', task_id: task.task_id,
    task_envelope_hash: task.integrity.hash,
    issued_at: '2026-07-26T12:01:00Z', expires_at: '2026-07-26T13:00:00Z',
    nonce: 'amend', actions: ['amend_task'], approval_receipt_ids: [],
  }, pair.privateKey);
  const dir = path.join(root, '.claude', 'authority', 'capabilities');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'amend-once.json'), JSON.stringify(receipt));
  const updated = amend(root, { allow: ['test/**'] }, new Date('2026-07-26T12:10:00Z'));
  assert.strictEqual(updated.version, 2);
  assert.strictEqual(updated.previous_envelope_hash, task.integrity.hash);
  assert.ok(updated.allowed_paths.includes('test/**'));
  assert.strictEqual(lifecycleStatus(root, updated, new Date('2026-07-26T12:11:00Z')).state, 'active');
});
