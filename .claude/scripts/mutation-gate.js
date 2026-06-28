#!/usr/bin/env node

'use strict';

// Mutation-smoke ratchet gate (gap G7) — diff-scoped CLI. Runs the existing
// mutation-smoke runner over the CHANGED production files only (bounded by
// --max-mutants so it stays cheap for agent loops), per language, and reports
// SURVIVORS — mutations no test killed, i.e. behavior the suite does not verify.
// Orchestration + interpretation live in hooks/lib/mutation-gate (reused by the
// pre-commit gate); this file is just the CLI surface.
//
// CLI: node .claude/scripts/mutation-gate.js [--staged | <file>...] [--threshold 0.8] [--max-mutants 12]
// Exit 0 = pass (or nothing to mutate), 1 = surviving mutants below threshold,
// 2 = usage.

const { execFileSync } = require('child_process');
const { runMutationOnFiles, renderSurvivors } = require('../hooks/lib/mutation-gate');

function stagedFiles(cwd) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (_) { return []; }
}

function parseArgs(argv) {
  const o = { files: [], staged: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') o.staged = true;
    else if (a === '--threshold') o.threshold = parseFloat(argv[++i]);
    else if (a === '--max-mutants') o.maxMutants = parseInt(argv[++i], 10);
    else if (!a.startsWith('--')) o.files.push(a);
  }
  return o;
}

function report(results) {
  for (const r of results) {
    if (r.skipped) { process.stderr.write(`WARNING: mutation gate SKIPPED for ${r.lang} — ${r.reason}.\n`); continue; }
    const pct = r.score == null ? 'n/a' : `${Math.round(r.score * 100)}%`;
    process.stdout.write(`mutation-gate (${r.lang}): ${r.pass ? 'PASS' : 'FAIL'} — score ${pct}, ${r.survived.length} survived\n`);
    if (r.survived.length) process.stdout.write(renderSurvivors(r.survived) + '\n');
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const files = o.files.length ? o.files : (o.staged ? stagedFiles(cwd) : []);
  const { results, blocked } = runMutationOnFiles(files, cwd, o);
  report(results);
  process.exit(blocked.length ? 1 : 0);
}

if (require.main === module) main();
