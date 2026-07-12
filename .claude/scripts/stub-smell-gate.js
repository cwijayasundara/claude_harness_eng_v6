#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/stub-smell-gate.js --staged
// Stub-to-green guard (Bun Phase A): git plumbing here; pure classification in
// hooks/lib/stub-smell.js.

const { execFileSync } = require('child_process');
const { classifyStubFiles, findingLine, isProductionSource } = require('../hooks/lib/stub-smell');

function gitShow(exec, ref) {
  try {
    return String(exec('git', ['show', ref]));
  } catch (_) {
    return null;
  }
}

function gitDiffFiles(exec, filter) {
  return String(exec('git', ['diff', '--cached', '--name-only', `--diff-filter=${filter}`]))
    .split('\n')
    .filter(Boolean);
}

function collectStagedProduction(exec) {
  const added = gitDiffFiles(exec, 'A').filter(isProductionSource);
  const modified = gitDiffFiles(exec, 'M').filter(isProductionSource);
  const out = [];
  for (const file of [...added, ...modified]) {
    const content = gitShow(exec, `:${file}`);
    if (content == null) continue;
    out.push({ file, content });
  }
  return out;
}

function checkStaged(exec) {
  const findings = classifyStubFiles(collectStagedProduction(exec));
  return { pass: findings.length === 0, findings };
}

function reportVerdict(verdict) {
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`stub-smell-gate: ${label} — ${verdict.findings.length} finding(s)\n`);
  for (const f of verdict.findings) process.stdout.write(`${findingLine(f)}\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  if (argv[0] !== '--staged') {
    process.stderr.write('usage: stub-smell-gate.js --staged\n');
    return 2;
  }
  const verdict = checkStaged(exec);
  reportVerdict(verdict);
  return verdict.pass ? 0 : 1;
}

module.exports = { collectStagedProduction, checkStaged, findingLine, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
