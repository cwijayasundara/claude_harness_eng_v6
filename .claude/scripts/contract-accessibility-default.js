#!/usr/bin/env node

'use strict';

// Default-on accessibility (gap G12, slice 2). Deterministically injects a
// default accessibility_checks block into a finalized sprint contract when the
// contract has UI checks (playwright_checks), so the evaluator's axe-core gate
// runs on UI stories without relying on the generator to remember it. Opt out
// per project with project-manifest.json#accessibility.enabled = false; a
// contract that already defines accessibility_checks is respected. Only ever
// ADDS the block — never edits/removes other checks. Not a gate (exit 0 always).
//
// CLI: node .claude/scripts/contract-accessibility-default.js <contract-path> [--root DIR]

const fs = require('fs');
const path = require('path');

function normalizeContract(contract, opts) {
  const enabled = !(opts && opts.enabled === false);
  if (!enabled) return contract;
  if (contract.accessibility_checks) return contract;
  if (Array.isArray(contract.playwright_checks) && contract.playwright_checks.length > 0) {
    return { ...contract, accessibility_checks: { required: true, block_impacts: ['serious', 'critical'] } };
  }
  return contract;
}

function parse(argv) {
  let root = process.cwd();
  let contractPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (!argv[i].startsWith('--')) contractPath = argv[i];
  }
  return { root, contractPath };
}

function main() {
  const { root, contractPath } = parse(process.argv.slice(2));
  if (!contractPath) {
    process.stdout.write('contract-accessibility-default: no contract path given\n');
    process.exit(0);
  }
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
  } catch (_) { /* none */ }
  const enabled = !(manifest.accessibility && manifest.accessibility.enabled === false);
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (e) {
    process.stdout.write(`contract-accessibility-default: cannot read ${contractPath} — ${e.message}\n`);
    process.exit(0);
  }
  const out = normalizeContract(contract, { enabled });
  if (out !== contract) {
    fs.writeFileSync(contractPath, JSON.stringify(out, null, 2) + '\n');
    process.stdout.write('contract-accessibility-default: added accessibility_checks (UI story)\n');
  } else {
    const reason = !enabled ? 'disabled' : contract.accessibility_checks ? 'already set' : 'no playwright_checks';
    process.stdout.write(`contract-accessibility-default: unchanged (${reason})\n`);
  }
  process.exit(0);
}

module.exports = { normalizeContract };

if (require.main === module) main();
