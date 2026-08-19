#!/usr/bin/env node
'use strict';

// CLI: node .claude/scripts/trajectory-contract.js --staged
// Assembles existing receipts and evaluates the trajectory join.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isSource } = require('./ownership-check');
const { isTestFile } = require(path.join(__dirname, '..', 'hooks', 'lib', 'tdd'));
const { isBrownfieldGraphReal } = require(path.join(__dirname, '..', 'hooks', 'lib', 'sensor-tier'));
const { readLedger } = require(path.join(__dirname, '..', 'hooks', 'lib', 'red-phase-ledger'));
const { evaluateTrajectory } = require(path.join(__dirname, '..', 'hooks', 'lib', 'trajectory-contract'));

const VERDICT_REL = path.join('specs', 'reviews', 'trajectory.json');

function gitShow(exec, ref) {
  try { return String(exec('git', ['show', ref])); } catch (_) { return null; }
}

function stagedNames(exec) {
  return String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']))
    .split('\n').filter(Boolean);
}

function readJson(root, rel) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch (_) { return null; }
}

function readJsonl(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8').split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function hasComponentMap(root) {
  return fs.existsSync(path.join(root, 'specs', 'design', 'component-map.md'));
}

function storyOwnedFiles(exec, root) {
  if (!hasComponentMap(root)) return [];
  return stagedNames(exec).filter((f) => isSource(f) && !isTestFile(f));
}

function loadReceipts(root) {
  const ledger = readLedger(root);
  return {
    contextPack: readJson(root, path.join('.claude', 'state', 'context-pack-last.json')),
    atRed: readJsonl(root, path.join('specs', 'reviews', 'at-red-receipts.jsonl')),
    coverageVerdicts: readJsonl(root, path.join('specs', 'reviews', 'coverage-verdicts.jsonl')),
    redPhaseEvents: ledger.events || [],
  };
}

function writeVerdict(root, verdict) {
  const dest = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(verdict, null, 2)}\n`);
}

function evaluateFromDisk(root, exec, now) {
  return evaluateTrajectory({
    storyOwnedFiles: storyOwnedFiles(exec, root),
    graphReal: isBrownfieldGraphReal(root),
    receipts: loadReceipts(root),
    now: now || Date.now(),
  });
}

function report(verdict) {
  process.stdout.write(`trajectory-contract: ${verdict.status.toUpperCase()} — ${verdict.reason}\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec)
    || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  if (argv[0] !== '--staged') {
    process.stderr.write('usage: trajectory-contract.js --staged\n');
    return 2;
  }
  const verdict = evaluateFromDisk(root, exec, deps && deps.now);
  writeVerdict(root, verdict);
  report(verdict);
  return verdict.status === 'fail' ? 1 : 0;
}

module.exports = { evaluateFromDisk, loadReceipts, storyOwnedFiles, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
