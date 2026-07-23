#!/usr/bin/env node

'use strict';

// C4 part 2 — drift detection via `terraform plan` instead of hand-rolled GET + diff.
//
// provision-protection.js --verify and provision-environments.js --verify each fetch the
// live GitHub state and diff it against a desired spec by hand. Terraform already does
// exactly that: `plan -detailed-exitcode` answers 0 = matches, 2 = changes pending
// (drift), 1 = error. This is the thin reporter over it.
//
// The output keeps the SAME contract those verifiers emit, because attestation-io
// #classifyVerify and fleet-retrofit both read it: `compliant` is a BOOLEAN (anything
// else is classified "invalid" and the signal is lost), plus a structured drift[].
//
// Every non-success path lands on compliant:false. A drift reporter that answers
// "compliant" when it could not actually check is the failure mode this harness keeps
// finding in its own gates — terraform missing, a plan error, or an uninitialised
// directory are all reported, never a vacuous pass.
//
//   node .claude/scripts/terraform-verify.js [--dir terraform] [--out <name>-verify.json]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIR = 'terraform';
const DEFAULT_OUT = 'branch-protection-verify.json';

// `  # github_organization_ruleset.name will be updated in-place`
const RESOURCE_LINE = /^\s*#\s+([A-Za-z0-9_.[\]"-]+)\s+will be\s+(.+)$/;

const ACTION_WORDS = [
  [/destroy/i, 'destroy'],
  [/created/i, 'create'],
  [/updated|changed/i, 'update'],
  [/replaced/i, 'replace'],
  [/read/i, 'read'],
];

function actionFor(phrase) {
  for (const [re, name] of ACTION_WORDS) if (re.test(phrase)) return name;
  return 'change';
}

function parseDriftResources(stdout) {
  const out = [];
  for (const line of String(stdout || '').split('\n')) {
    const m = line.match(RESOURCE_LINE);
    if (m) out.push({ resource: m[1], action: actionFor(m[2]) });
  }
  return out;
}

function defaultRun(dir) {
  return () => spawnSync('terraform', ['plan', '-detailed-exitcode', '-no-color', '-input=false'], {
    cwd: dir, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024,
  });
}

// An error mentioning init is a provisioning gap, not evidence about the fleet. Kept
// distinct so an operator sees "you have not run terraform init" rather than "drift".
function looksUninitialised(text) {
  return /terraform init|Could not load plugin|no configuration files/i.test(text || '');
}

const unprovisioned = (reason) => ({ compliant: false, status: 'unprovisioned', reason, drift: [] });

function driftResult(stdout) {
  const drift = parseDriftResources(stdout);
  return {
    compliant: false,
    status: 'drift',
    reason: drift.length
      ? `terraform plan reports ${drift.length} pending change(s)`
      : 'terraform plan reports pending changes but no resource lines could be parsed — treat as drift',
    drift,
  };
}

// Exit 1 is ambiguous: a genuine plan failure, or simply a directory nobody ran
// `terraform init` in. Separated so the operator gets the actionable one.
function failureResult(stdout, stderr) {
  if (looksUninitialised(stdout + stderr)) {
    return unprovisioned('terraform working directory is not initialised — run `terraform init`');
  }
  return {
    compliant: false,
    status: 'error',
    reason: `terraform plan failed: ${(stderr || stdout).split('\n')[0].slice(0, 200)}`,
    drift: [],
  };
}

function verifyWithTerraform({ dir = DEFAULT_DIR, run = null } = {}) {
  const exec = run || defaultRun(dir);
  let res;
  try {
    res = exec();
  } catch (err) {
    return unprovisioned(
      `terraform could not be run (${err.code || err.message}) — install terraform or run this where it is available`
    );
  }
  if (res.status === 0) {
    return { compliant: true, status: 'match', reason: 'terraform plan reports no changes', drift: [] };
  }
  if (res.status === 2) return driftResult(res.stdout || '');
  return failureResult(res.stdout || '', res.stderr || '');
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

function main(argv = process.argv.slice(2)) {
  const root = argValue(argv, '--root') || REPO_ROOT;
  const dir = path.join(root, argValue(argv, '--dir') || DEFAULT_DIR);
  const outName = argValue(argv, '--out') || DEFAULT_OUT;

  const report = { ...verifyWithTerraform({ dir }), source: 'terraform-plan', checked_at: new Date().toISOString() };
  const outDir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, outName), JSON.stringify(report, null, 2) + '\n');

  console.log(`terraform-verify: ${report.status} — ${report.reason}`);
  for (const d of report.drift) console.log(`  ${d.action.padEnd(8)} ${d.resource}`);
  // Non-zero only on real drift; unprovisioned/error are reported loudly but must not
  // masquerade as a drift finding.
  return report.status === 'drift' ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { verifyWithTerraform, parseDriftResources, actionFor };
