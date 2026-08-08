'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalize, contentHash } = require('./task-envelope');

const TRUST_REL = path.join('.claude', 'trust', 'issuers.json');
const AUTHORITY_REL = path.join('.claude', 'authority');
const SENSITIVE_ACTIONS = Object.freeze({
  merge: /\b(?:git\s+merge|gh\s+pr\s+merge)\b/i,
  deploy: /\b(?:kubectl\s+(?:apply|delete|rollout)|terraform\s+apply|vercel\s+deploy|aws\s+.*deploy|gcloud\s+.*deploy|npm\s+run\s+deploy)\b/i,
  modify_branch_protection: /\bgh\s+api\b.*(?:rulesets|branch(?:es)?\/.*protection)/i,
  execute_production_change: /\b(?:prod(?:uction)?)[-_\s]*(?:migrate|deploy|apply|delete|write)\b/i,
});

function unsigned(receipt) {
  const body = { ...receipt };
  delete body.signature;
  return body;
}

function signReceipt(body, privateKey) {
  const value = crypto.sign(null, Buffer.from(canonicalize(body)), privateKey).toString('base64');
  return { ...body, signature: { algorithm: 'Ed25519', value } };
}

function loadTrust(root) {
  const file = path.join(root, TRUST_REL);
  if (!fs.existsSync(file)) return { state: 'absent', file, issuers: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.schema_version !== 1 || !Array.isArray(parsed.issuers)) throw new Error('invalid issuer registry');
    return { state: 'valid', file, issuers: parsed.issuers };
  } catch (err) {
    return { state: 'invalid', file, issuers: [], error: err.message };
  }
}

function verifyReceipt(receipt, { trust, envelope, type, action, now = new Date() }) {
  const errors = [];
  if (!receipt || receipt.schema_version !== 1) errors.push('schema_version must be 1');
  if (receipt && receipt.type !== type) errors.push(`receipt type must be ${type}`);
  const issuer = receipt && trust.issuers.find((item) =>
    item.issuer === receipt.issuer && item.key_id === receipt.key_id && item.enabled !== false);
  if (!issuer) errors.push('issuer/key is not trusted');
  else if (!Array.isArray(issuer.allowed_types) || !issuer.allowed_types.includes(type)) {
    errors.push(`issuer is not authorized for ${type} receipts`);
  }
  if (!receipt || !receipt.receipt_id) errors.push('receipt_id is required');
  if (!receipt || receipt.task_id !== envelope.task_id) errors.push('task_id mismatch');
  if (!receipt || receipt.task_envelope_hash !== contentHash(envelope)) errors.push('task envelope hash mismatch');
  if (action && (!receipt.actions || !receipt.actions.includes(action))) errors.push(`action ${action} is not granted`);
  const timestamp = now.getTime();
  if (!receipt || !Number.isFinite(Date.parse(receipt.issued_at))) errors.push('issued_at is invalid');
  else if (Date.parse(receipt.issued_at) > timestamp + 60_000) errors.push('receipt is not yet valid');
  if (!receipt || !Number.isFinite(Date.parse(receipt.expires_at))) errors.push('expires_at is invalid');
  else if (Date.parse(receipt.expires_at) <= timestamp) errors.push('receipt has expired');
  if (!receipt || !receipt.nonce) errors.push('nonce is required');
  if (type === 'human_approval' && (!receipt.approver_id || receipt.decision !== 'approved')) {
    errors.push('human approval requires approver_id and decision=approved');
  }
  if (type === 'capability' && (!Array.isArray(receipt.actions) || receipt.actions.length === 0)) {
    errors.push('capability requires at least one action');
  }
  if (type === 'human_execution' && (!receipt.approver_id || !receipt.execution_ref)) {
    errors.push('human execution requires approver_id and execution_ref');
  }
  if (type === 'runtime_attestation' && (!receipt.runtime_id || !receipt.policy_hash
    || receipt.network_enforced !== true || receipt.credential_brokered !== true
    || !Array.isArray(receipt.read_only_paths))) {
    errors.push('runtime attestation requires runtime_id, policy_hash, enforced network, brokered credentials, and read_only_paths');
  }
  if (!receipt || !receipt.signature || receipt.signature.algorithm !== 'Ed25519') {
    errors.push('Ed25519 signature is required');
  } else if (issuer) {
    try {
      const valid = crypto.verify(
        null,
        Buffer.from(canonicalize(unsigned(receipt))),
        issuer.public_key_pem,
        Buffer.from(receipt.signature.value || '', 'base64'),
      );
      if (!valid) errors.push('signature verification failed');
    } catch (err) {
      errors.push(`signature verification failed: ${err.message}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// Actions that are privileged only where an approval service exists to
// authorize them. A control with no path to "yes" is a wall, not a gate:
// without a trust registry no capability can be issued, so requiring one for
// `merge` blocked every merge — including ones the repo owner had explicitly
// authorized — and the only way past it was to disable the control, which is
// strictly worse than not having gated it.
//
// Where issuers.json IS provisioned (the compliance case this was built for),
// merge stays privileged and nothing changes. Deploy, branch-protection and
// production changes stay privileged either way; production is non-delegable
// and is blocked before the envelope check regardless.
const NEEDS_ISSUER_TO_GATE = new Set(['merge']);

/**
 * @param {string} command
 * @param {object} [opts] `trustConfigured: false` relaxes the issuer-dependent
 *   actions. Omitted means gated — the narrowing is opt-in, never a silent
 *   default for a caller that has not considered it.
 */
function detectSensitiveAction(command, opts = {}) {
  const action = Object.entries(SENSITIVE_ACTIONS)
    .find(([, pattern]) => pattern.test(command))?.[0] || null;
  if (action && opts.trustConfigured === false && NEEDS_ISSUER_TO_GATE.has(action)) return null;
  return action;
}

function receiptFiles(root, kind) {
  const dir = path.join(root, AUTHORITY_REL, kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => path.join(dir, name));
}

function readReceipts(root, kind) {
  return receiptFiles(root, kind).flatMap((file) => {
    try { return [{ file, receipt: JSON.parse(fs.readFileSync(file, 'utf8')) }]; } catch (_) { return []; }
  });
}

function validApprovals(root, envelope, trust, now) {
  return readReceipts(root, 'approvals').filter(({ receipt }) =>
    verifyReceipt(receipt, { trust, envelope, type: 'human_approval', now }).valid);
}

function findCapability(root, envelope, action, now = new Date()) {
  const trust = loadTrust(root);
  if (trust.state !== 'valid') return { valid: false, errors: [`trusted issuer registry is ${trust.state}`] };
  const approvals = validApprovals(root, envelope, trust, now);
  const distinctApprovers = new Set(approvals.map(({ receipt }) => receipt.approver_id));
  for (const candidate of readReceipts(root, 'capabilities')) {
    const checked = verifyReceipt(candidate.receipt, { trust, envelope, type: 'capability', action, now });
    if (!checked.valid) continue;
    const referenced = new Set(candidate.receipt.approval_receipt_ids || []);
    const matched = approvals.filter(({ receipt }) => referenced.has(receipt.receipt_id));
    const matchedApprovers = new Set(matched.map(({ receipt }) => receipt.approver_id));
    if (matchedApprovers.size < envelope.required_approvals) continue;
    return { valid: true, ...candidate, approvals: matched };
  }
  return {
    valid: false,
    errors: [`no valid ${action} capability with ${envelope.required_approvals} distinct signed approval(s)`],
    approvals: distinctApprovers.size,
  };
}

function consumeCapability(root, capability, action, now = new Date()) {
  const dir = path.join(root, '.claude', 'state', 'used-capabilities');
  const file = path.join(dir, `${capability.receipt_id}.json`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify({
      receipt_id: capability.receipt_id, action, consumed_at: now.toISOString(),
    })}\n`);
    fs.closeSync(fd);
    return { consumed: true, file };
  } catch (err) {
    if (err.code === 'EEXIST') return { consumed: false, file, error: 'capability was already consumed' };
    throw err;
  }
}

module.exports = {
  AUTHORITY_REL,
  SENSITIVE_ACTIONS,
  consumeCapability,
  detectSensitiveAction,
  findCapability,
  loadTrust,
  readReceipts,
  signReceipt,
  unsigned,
  validApprovals,
  verifyReceipt,
};
