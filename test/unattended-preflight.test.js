'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { test } = require('node:test');
const { assessPreflight } = require('../.claude/scripts/unattended-preflight');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');
const { signReceipt } = require('../.claude/hooks/lib/authority-receipt');
const { policyHash } = require('../.claude/scripts/runtime-policy');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unattended-preflight-'));
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.auto.json'), JSON.stringify({
    sandbox: { enabled: true, failIfUnavailable: true },
  }));
  fs.writeFileSync(path.join(root, '.claude', 'unattended-policy.json'), JSON.stringify({
    version: 1,
    network: { mode: 'deny-by-default', allowed_domains: [] },
    required_scanners: ['gitleaks', 'semgrep'],
    credential_paths: ['.ssh'],
    authority: {
      read_only_paths: [
        '.claude/hooks', '.claude/settings.json', '.claude/settings.auto.json',
        '.claude/trust', '.claude/authority', '.claude/certification',
        '.claude/config/autonomy-policy.json',
        '.claude/state/autonomy-policy.json',
      ],
    },
  }));
  const envelope = stampEnvelope({
    schema_version: 1, task_id: 'TASK-1', risk_tier: 'R2',
    allowed_paths: ['src/**'], forbidden_actions: ['merge'], required_evidence: ['unit'],
    required_approvals: 1,
    budgets: { dimensions: [{ unit: 'agents', limit: 10 }] },
  });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(envelope));
  const pair = crypto.generateKeyPairSync('ed25519');
  const runtimePolicy = {
    schema_version: 1,
    network: { mode: 'deny-by-default', allowed_domains: [] },
    read_only_paths: [
      '.claude/hooks', '.claude/settings.json', '.claude/settings.auto.json',
      '.claude/trust', '.claude/authority', '.claude/certification',
      '.claude/config/autonomy-policy.json',
      '.claude/state/autonomy-policy.json',
    ],
    broker_only_commands: ['gh'],
    credentials: {},
  };
  const effectivePolicy = {
    ...JSON.parse(fs.readFileSync(path.join(root, '.claude', 'unattended-policy.json'), 'utf8')),
    ...runtimePolicy,
  };
  fs.writeFileSync(path.join(root, '.claude', 'unattended-policy.json'), JSON.stringify(effectivePolicy));
  fs.mkdirSync(path.join(root, '.claude', 'trust'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'trust', 'issuers.json'), JSON.stringify({
    schema_version: 1,
    issuers: [{
      issuer: 'runtime-controller', key_id: 'runtime-1',
      public_key_pem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      allowed_types: ['runtime_attestation'],
    }],
  }));
  const runtime = signReceipt({
    schema_version: 1, type: 'runtime_attestation', receipt_id: 'runtime-proof',
    issuer: 'runtime-controller', key_id: 'runtime-1', task_id: envelope.task_id,
    task_envelope_hash: envelope.integrity.hash,
    issued_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(), nonce: 'runtime-nonce',
    runtime_id: 'ci-job-1', policy_hash: policyHash(effectivePolicy),
    network_enforced: true, credential_brokered: true,
    read_only_paths: runtimePolicy.read_only_paths,
  }, pair.privateKey);
  const runtimeDir = path.join(root, '.claude', 'authority', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'runtime-proof.json'), JSON.stringify(runtime));
  fs.writeFileSync(path.join(root, '.claude', 'state', 'isolation-evidence.json'), JSON.stringify({
    verified: true, isolation: 'ci', no_host_credentials: true,
    egress_policy_applied: true, policy_files_read_only: true,
    authority_receipts_read_only: true,
  }));
  return root;
}

test('preflight passes with a contract, sandbox, scrub, isolation, policy, and scanners', () => {
  const root = fixture();
  let reconciled = false;
  const result = assessPreflight({
    root,
    env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', CI: 'true' },
    home: path.join(root, 'empty-home'),
    exists: (target) => target === '/.dockerenv' ? false : fs.existsSync(target),
    probe: () => {},
    certificationCheck: () => ({ pass: true, failures: [] }),
    autonomyCheck: () => ({ pass: true, mode: 'unattended', failures: [] }),
    autonomyReconcile: () => { reconciled = true; return { changed: false }; },
  });
  assert.strictEqual(result.pass, true, result.failures.join(', '));
  assert.strictEqual(result.isolation.kind, 'ci');
  assert.strictEqual(reconciled, true);
});

test('preflight fails closed on credentials, missing scrub, isolation, and scanners', () => {
  const root = fixture();
  const home = path.join(root, 'home');
  fs.unlinkSync(path.join(root, '.claude', 'state', 'isolation-evidence.json'));
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ssh', 'id_key'), 'fixture');
  const result = assessPreflight({
    root,
    env: { AWS_ACCESS_KEY_ID: 'fixture' },
    home,
    exists: (target) => target === '/.dockerenv' ? false : fs.existsSync(target),
    probe: () => { throw new Error('missing'); },
    certificationCheck: () => ({ pass: false, failures: ['expired'] }),
    autonomyCheck: () => ({ pass: true, mode: 'attended', failures: [] }),
    autonomyReconcile: () => ({ changed: false }),
  });
  assert.strictEqual(result.pass, false);
  assert.ok(result.failures.includes('subprocess-env-scrub-disabled'));
  assert.ok(result.failures.includes('isolation-unverified'));
  assert.ok(result.failures.includes('credential-in-environment:AWS_ACCESS_KEY_ID'));
  assert.ok(result.failures.includes('host-credential-path-mounted:.ssh'));
  assert.ok(result.failures.includes('required-scanner-unavailable:gitleaks'));
  assert.ok(result.failures.includes('authority-read-only-boundary-unverified'));
  assert.ok(result.failures.includes('security-certification:expired'));
  assert.ok(result.failures.includes('autonomy-mode:attended:unattended-required'));
});
