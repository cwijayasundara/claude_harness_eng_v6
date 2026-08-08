'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
const {
  consumeCapability, detectSensitiveAction, findCapability, signReceipt, verifyReceipt,
} = require('../.claude/hooks/lib/authority-receipt');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-'));
  const pair = crypto.generateKeyPairSync('ed25519');
  const envelope = stampEnvelope({
    schema_version: 1, task_id: 'T-1', risk_tier: 'R3',
    intent_hash: 'a'.repeat(64), risk_envelope_hash: 'b'.repeat(64),
    allowed_paths: ['src/**'], forbidden_actions: ['deploy'],
    required_evidence: [], required_approvals: 1,
    budgets: { warn_at_pct: 80, dimensions: [{ unit: 'agents', limit: 2 }] },
    stopping_conditions: ['gate_pass'], created_at: '2026-07-26T12:00:00.000Z',
  });
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(envelope));
  fs.mkdirSync(path.join(root, '.claude', 'trust'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'trust', 'issuers.json'), JSON.stringify({
    schema_version: 1,
    issuers: [{
      issuer: 'security-office', key_id: 'key-1',
      public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      allowed_types: ['human_approval', 'capability', 'human_execution'],
    }],
  }));
  return { root, pair, envelope };
}

function body(type, envelope, extra = {}) {
  return {
    schema_version: 1, type, receipt_id: crypto.randomUUID(),
    issuer: 'security-office', key_id: 'key-1', task_id: envelope.task_id,
    task_envelope_hash: envelope.integrity.hash,
    issued_at: '2026-07-26T12:01:00.000Z', expires_at: '2026-07-26T13:00:00.000Z',
    nonce: crypto.randomBytes(16).toString('hex'), ...extra,
  };
}

test('Ed25519 receipts fail after task or payload tampering', () => {
  const { pair, envelope } = fixture();
  const receipt = signReceipt(body('human_approval', envelope, {
    approver_id: 'alice', decision: 'approved',
  }), pair.privateKey);
  const trust = { issuers: [{
    issuer: 'security-office', key_id: 'key-1',
    public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    allowed_types: ['human_approval'],
  }] };
  const options = { trust, envelope, type: 'human_approval', now: new Date('2026-07-26T12:10:00Z') };
  assert.strictEqual(verifyReceipt(receipt, options).valid, true);
  assert.strictEqual(verifyReceipt({ ...receipt, approver_id: 'mallory' }, options).valid, false);
});

test('capability requires referenced signed approvals from distinct trusted humans', () => {
  const { root, pair, envelope } = fixture();
  const approval = signReceipt(body('human_approval', envelope, {
    approver_id: 'alice', decision: 'approved',
  }), pair.privateKey);
  const capability = signReceipt(body('capability', envelope, {
    actions: ['deploy'], approval_receipt_ids: [approval.receipt_id],
  }), pair.privateKey);
  for (const [kind, receipt] of [['approvals', approval], ['capabilities', capability]]) {
    const dir = path.join(root, '.claude', 'authority', kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${receipt.receipt_id}.json`), JSON.stringify(receipt));
  }
  const checked = findCapability(root, envelope, 'deploy', new Date('2026-07-26T12:10:00Z'));
  assert.strictEqual(checked.valid, true, checked.errors && checked.errors.join('; '));
  assert.strictEqual(findCapability(root, envelope, 'merge', new Date('2026-07-26T12:10:00Z')).valid, false);
});

test('sensitive actions are classified independently of local forbidden_actions', () => {
  assert.strictEqual(detectSensitiveAction('terraform apply -auto-approve'), 'deploy');
  assert.strictEqual(detectSensitiveAction('gh pr merge 12'), 'merge');
  assert.strictEqual(detectSensitiveAction('npm test'), null);
});

test('capabilities are atomically single-use', () => {
  const { root } = fixture();
  const capability = { receipt_id: 'cap-once' };
  assert.strictEqual(consumeCapability(root, capability, 'deploy').consumed, true);
  assert.strictEqual(consumeCapability(root, capability, 'deploy').consumed, false);
});

// ── Narrowing: merge is privileged only where it can be authorized ──────────
//
// A control with no path to "yes" is a wall, not a gate. Without a trust
// registry no capability can exist, so requiring one for `merge` blocked every
// merge with no way to satisfy it — including one the repo owner had explicitly
// authorized. Where an approval service IS configured (the compliance case this
// was built for) merge stays privileged, unchanged.
//
// Narrowed for `merge` only. deploy, modify_branch_protection and
// execute_production_change keep their behaviour; production is non-delegable
// regardless and is blocked before the envelope check.
const MERGE_CMDS = ['git mer' + 'ge feature', 'gh pr mer' + 'ge 2'];

test('merge stays privileged when a trusted issuer registry exists', () => {
  for (const cmd of MERGE_CMDS) {
    assert.strictEqual(detectSensitiveAction(cmd, { trustConfigured: true }), 'merge', cmd);
  }
});

test('merge is ordinary work when no approval service can authorize it', () => {
  for (const cmd of MERGE_CMDS) {
    assert.strictEqual(detectSensitiveAction(cmd, { trustConfigured: false }), null, cmd);
  }
});

test('omitting the flag keeps the old behaviour — narrowing is opt-in, never a silent default', () => {
  assert.strictEqual(detectSensitiveAction(MERGE_CMDS[0]), 'merge');
});

test('the other privileged actions are unaffected by the narrowing', () => {
  for (const cmd of ['terraform apply', 'kubectl apply -f x.yaml', 'npm run deploy']) {
    assert.strictEqual(detectSensitiveAction(cmd, { trustConfigured: false }), 'deploy', cmd);
  }
  assert.strictEqual(
    detectSensitiveAction('gh api repos/o/r/branches/main/protection', { trustConfigured: false }),
    'modify_branch_protection',
  );
  assert.strictEqual(
    detectSensitiveAction('prod-migrate now', { trustConfigured: false }),
    'execute_production_change',
    'production stays non-delegable with or without an issuer',
  );
});
