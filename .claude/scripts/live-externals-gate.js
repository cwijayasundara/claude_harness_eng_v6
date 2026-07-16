#!/usr/bin/env node
'use strict';

// CLI: node .claude/scripts/live-externals-gate.js --staged
// live-externals sensor (gap G36): git plumbing here; pure classification lives
// in hooks/lib/live-externals-gate.js (same split test-deletion-gate.js uses).

const { execFileSync } = require('child_process');
const { classifyFiles } = require('../hooks/lib/live-externals-gate');

function gitShow(exec, ref) {
  try { return String(exec('git', ['show', ref])); } catch (_) { return null; }
}

function stagedFiles(exec) {
  return String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']))
    .split('\n').filter(Boolean);
}

function collectStaged(exec) {
  return stagedFiles(exec)
    .map((file) => ({ file, content: gitShow(exec, `:${file}`) }))
    .filter((c) => c.content !== null);
}

function checkStaged(exec) {
  const findings = classifyFiles(collectStaged(exec));
  return { pass: findings.length === 0, findings };
}

function findingLine(f) {
  const label = { 'live-url': 'LIVE URL    ', 'live-dsn': 'LIVE DB DSN ', 'sdk-client': 'RAW SDK     ' }[f.kind];
  return `  ${label} ${f.file}:${f.line}  ${f.snippet}`;
}

function reportVerdict(v) {
  process.stdout.write(`live-externals: ${v.pass ? 'PASS' : 'FAIL'} — ${v.findings.length} finding(s)\n`);
  for (const f of v.findings) process.stdout.write(`${findingLine(f)}\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  if (argv[0] !== '--staged') { process.stderr.write('usage: live-externals-gate.js --staged\n'); return 2; }
  const v = checkStaged(exec);
  reportVerdict(v);
  return v.pass ? 0 : 1;
}

module.exports = { collectStaged, checkStaged, findingLine, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
