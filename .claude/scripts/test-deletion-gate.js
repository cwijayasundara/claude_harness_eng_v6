#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/test-deletion-gate.js --staged
// Test-deletion / skip guard (gap G31): git plumbing lives here; pure
// content classification lives in hooks/lib/test-deletion-gate.js (same
// split cycle-gate.js and legacy-discipline-gate.js already use).

const { execFileSync } = require('child_process');
const { classifyTestFileChanges } = require('../hooks/lib/test-deletion-gate');
const { isTestFile } = require('../hooks/lib/tdd');

function gitShow(exec, ref) {
  try {
    return String(exec('git', ['show', ref]));
  } catch (_) {
    return null; // did not exist at that ref (new file) or unreadable
  }
}

function gitDiffFiles(exec, filter) {
  return String(exec('git', ['diff', '--cached', '--name-only', `--diff-filter=${filter}`]))
    .split('\n')
    .filter(Boolean);
}

// {file, oldContent, newContent} for every staged test-shaped file that was
// modified or deleted. Newly ADDED test files are excluded up front (never a
// finding — see classifyTestFileChange's oldContent===null short-circuit).
function collectStagedChanges(exec) {
  const modified = gitDiffFiles(exec, 'M').filter(isTestFile);
  const deleted = gitDiffFiles(exec, 'D').filter(isTestFile);
  const out = [];
  for (const file of modified) {
    out.push({ file, oldContent: gitShow(exec, `HEAD:${file}`), newContent: gitShow(exec, `:${file}`) });
  }
  for (const file of deleted) {
    out.push({ file, oldContent: gitShow(exec, `HEAD:${file}`), newContent: null });
  }
  return out;
}

function checkStaged(exec) {
  const findings = classifyTestFileChanges(collectStagedChanges(exec));
  return { pass: findings.length === 0, findings };
}

function findingLine(f) {
  if (f.kind === 'deleted') return `  TEST FILE DELETED     ${f.file} (${f.oldTests} test case(s) lost)`;
  if (f.kind === 'count-decreased') return `  TEST COUNT DECREASED  ${f.file} (${f.oldTests} -> ${f.newTests})`;
  return `  NEW SKIP MARKER       ${f.file} (${f.oldSkips} -> ${f.newSkips})`;
}

function reportVerdict(verdict) {
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`test-deletion-guard: ${label} — ${verdict.findings.length} finding(s)\n`);
  for (const f of verdict.findings) process.stdout.write(`${findingLine(f)}\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  if (argv[0] !== '--staged') {
    process.stderr.write('usage: test-deletion-gate.js --staged\n');
    return 2;
  }
  const verdict = checkStaged(exec);
  reportVerdict(verdict);
  return verdict.pass ? 0 : 1;
}

module.exports = { collectStagedChanges, checkStaged, findingLine, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
