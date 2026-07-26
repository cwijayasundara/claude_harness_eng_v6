#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadEnvelope } = require('../hooks/lib/task-envelope');
const { verifyRuntime } = require('./runtime-policy');
const { verifyCertification } = require('./security-certification');
const { currentMode, reconcile } = require('./autonomy-policy');

const SENSITIVE_ENV = [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN',
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function directoryHasEntries(dir) {
  try { return fs.readdirSync(dir).length > 0; } catch (_) { return false; }
}

function scannerAvailable(name, probe) {
  try {
    (probe || execFileSync)(name, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function detectIsolation({ env, exists = fs.existsSync, evidence }) {
  if (exists('/.dockerenv')) return { isolated: true, kind: 'container', source: '/.dockerenv' };
  if (String(env.CI || '').toLowerCase() === 'true') return { isolated: true, kind: 'ci', source: 'CI=true' };
  if (evidence && evidence.verified === true
    && ['vm', 'container', 'ci'].includes(evidence.isolation)
    && evidence.no_host_credentials === true
    && evidence.egress_policy_applied === true) {
    return { isolated: true, kind: evidence.isolation, source: 'external-evidence' };
  }
  return { isolated: false, kind: null, source: null };
}

function assessPreflight({
  root,
  env = process.env,
  home = os.homedir(),
  exists = fs.existsSync,
  listHasEntries = directoryHasEntries,
  probe,
  certificationCheck = verifyCertification,
  autonomyCheck = currentMode,
  autonomyReconcile = reconcile,
} = {}) {
  const failures = [];
  const settings = readJson(path.join(root, '.claude', 'settings.auto.json'));
  const policy = readJson(path.join(root, '.claude', 'unattended-policy.json'));
  const evidence = readJson(path.join(root, '.claude', 'state', 'isolation-evidence.json'));
  const task = loadEnvelope(root);
  const runtime = verifyRuntime(root);
  const certification = certificationCheck(root, 'unattended-core');
  const autonomyReconciliation = autonomyReconcile(root);
  const autonomy = autonomyCheck(root, task.envelope && task.envelope.risk_tier);

  if (task.state !== 'valid') failures.push(`task-envelope:${task.state}${task.errors.length ? `:${task.errors.join('|')}` : ''}`);
  if (!settings || !settings.sandbox || settings.sandbox.enabled !== true
    || settings.sandbox.failIfUnavailable !== true) failures.push('sandbox-not-fail-closed');
  if (env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB !== '1') failures.push('subprocess-env-scrub-disabled');
  if (!policy || policy.version !== 1 || !policy.network
    || policy.network.mode !== 'deny-by-default'
    || !Array.isArray(policy.network.allowed_domains)) failures.push('egress-policy-missing-or-invalid');
  const readOnly = policy && policy.authority && policy.authority.read_only_paths;
  const requiredReadOnly = [
    '.claude/hooks', '.claude/settings.json', '.claude/settings.auto.json',
    '.claude/trust', '.claude/authority', '.claude/certification',
    '.claude/config/autonomy-policy.json',
    '.claude/state/autonomy-policy.json',
  ];
  if (!Array.isArray(readOnly) || requiredReadOnly.some((item) => !readOnly.includes(item))) {
    failures.push('authority-read-only-policy-missing');
  }
  if (!evidence || evidence.policy_files_read_only !== true
    || evidence.authority_receipts_read_only !== true) {
    failures.push('authority-read-only-boundary-unverified');
  }
  if (!runtime.pass) failures.push(...runtime.failures.map((item) => `runtime:${item}`));
  if (!certification.pass) {
    failures.push(...certification.failures.map((item) => `security-certification:${item}`));
  }
  if (!autonomy.pass || autonomy.mode !== 'unattended') {
    failures.push(`autonomy-mode:${autonomy.mode || 'unknown'}:unattended-required`);
  }

  const isolation = detectIsolation({ env, exists, evidence });
  if (!isolation.isolated) failures.push('isolation-unverified');

  for (const name of SENSITIVE_ENV) if (env[name]) failures.push(`credential-in-environment:${name}`);
  const credentialPaths = policy && Array.isArray(policy.credential_paths) ? policy.credential_paths : [];
  for (const rel of credentialPaths) {
    const target = path.join(home, rel);
    if (exists(target) && listHasEntries(target)) failures.push(`host-credential-path-mounted:${rel}`);
  }

  const scanners = policy && Array.isArray(policy.required_scanners) ? policy.required_scanners : [];
  for (const scanner of scanners) if (!scannerAvailable(scanner, probe)) failures.push(`required-scanner-unavailable:${scanner}`);

  return {
    pass: failures.length === 0,
    task_id: task.envelope && task.envelope.task_id,
    risk_tier: task.envelope && task.envelope.risk_tier,
    isolation,
    runtime_id: runtime.runtime_id || null,
    security_certification_profile: certification.pass ? 'unattended-core' : null,
    autonomy_mode: autonomy.mode || null,
    autonomy_regressions: autonomyReconciliation.regressions || [],
    network_mode: policy && policy.network && policy.network.mode,
    allowed_domains: policy && policy.network && policy.network.allowed_domains,
    failures,
    checked_at: new Date().toISOString(),
  };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = assessPreflight({ root });
  const out = path.join(root, '.claude', 'state', 'unattended-preflight.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) {
    process.stderr.write(`unattended-preflight: BLOCKED\n${result.failures.map((f) => `  - ${f}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `unattended-preflight: PASS task=${result.task_id} tier=${result.risk_tier} isolation=${result.isolation.kind}\n`
  );
}

module.exports = {
  SENSITIVE_ENV,
  assessPreflight,
  detectIsolation,
  directoryHasEntries,
  scannerAvailable,
};

if (require.main === module) main();
