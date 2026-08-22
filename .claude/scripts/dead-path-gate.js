#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/dead-path-gate.js [--staged] [--max-symbols 40]
// "Delete with each task" (SwarmForge pickup #4): git plumbing here, pure
// classification in hooks/lib/dead-path.js — the same split cycle-gate.js and
// test-deletion-gate.js already use.
//
// Fires only when THIS change removed the last production caller of a symbol
// whose definition is still in the tree. Pre-existing dead code belongs to the
// drift report; this gate keeps a commit from leaving its own orphans behind.
//
// Exit 0 = clean, 1 = orphaned definitions, 2 = usage/IO error.

const { execFileSync } = require('child_process');
const {
  classifyOrphans, definesSymbol, isKeepMarked, isReferenceLine, removedIdentifiers,
} = require('../hooks/lib/dead-path');

const SOURCE_RE = /\.(js|jsx|mjs|cjs|ts|tsx|py)$/;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/i;

function isSource(file) { return SOURCE_RE.test(file); }
function isTest(file) { return TEST_RE.test(file) || TEST_FILE_RE.test(file); }
function isProduction(file) { return isSource(file) && !isTest(file); }

function git(args, cwd) {
  return String(execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function gitQuiet(args, cwd) {
  try { return git(args, cwd); } catch (_) { return ''; }
}

function stagedFiles(cwd, filter) {
  return gitQuiet(['diff', '--cached', '--name-only', `--diff-filter=${filter}`], cwd)
    .split('\n').filter(Boolean);
}

/**
 * How many source lines CALL `name`, split production vs test. What counts as a
 * call is `isReferenceLine`'s decision (definitions, export listings and
 * imports are not calls) so the rule is unit-tested rather than buried here.
 */
function referenceCount(cwd, name, { cached }) {
  // `-e <pattern>` is load-bearing. `git grep -w HEAD -- <name>` reads as
  // pattern=HEAD, pathspec=<name> and matches nothing, which silently pinned
  // refsBefore at 0 and made the whole gate inert.
  const args = cached
    ? ['grep', '-n', '-w', '--cached', '-e', name]
    : ['grep', '-n', '-w', '-e', name, 'HEAD'];

  let production = 0;
  let tests = 0;
  for (const line of gitQuiet(args, cwd).split('\n').filter(Boolean)) {
    // `path:lineno:text` for --cached; `HEAD:path:lineno:text` otherwise.
    const parts = cached ? line.split(':') : line.split(':').slice(1);
    const file = parts[0];
    const text = parts.slice(2).join(':');
    if (!isSource(file)) continue;
    if (!isReferenceLine(text, name)) continue;
    if (isTest(file)) tests += 1; else production += 1;
  }
  return { production, tests };
}

/** The production file that still defines `name` in the staged tree, or null. */
function definitionSite(cwd, name) {
  const hits = gitQuiet(['grep', '-l', '-w', '--cached', '--', name], cwd).split('\n').filter(Boolean);
  for (const file of hits.filter(isProduction)) {
    const content = gitQuiet(['show', `:${file}`], cwd);
    if (definesSymbol(content, name)) return { file, content };
  }
  return null;
}

/** Every identifier this staged change dropped from a production call site. */
function candidateSymbols(cwd) {
  const candidates = new Set();
  const changed = [...stagedFiles(cwd, 'M'), ...stagedFiles(cwd, 'D')].filter(isProduction);
  for (const file of changed) {
    const before = gitQuiet(['show', `HEAD:${file}`], cwd);
    if (!before) continue;
    const after = gitQuiet(['show', `:${file}`], cwd); // '' when the file was deleted
    for (const name of removedIdentifiers(before, after)) candidates.add(name);
  }
  return [...candidates].sort();
}

// Counts only. classifyOrphans is the single owner of what counts as a finding
// — re-deciding it here would put one invariant in two places, and the copy is
// what rots.
function resolve(cwd, symbols) {
  const resolved = [];
  for (const symbol of symbols) {
    const before = referenceCount(cwd, symbol, { cached: false });
    const after = referenceCount(cwd, symbol, { cached: true });
    const site = definitionSite(cwd, symbol);
    resolved.push({
      symbol,
      definedIn: site ? site.file : null,
      refsBefore: before.production,
      refsAfter: after.production,
      testRefsAfter: after.tests,
      keepMarked: site ? isKeepMarked(site.content, symbol) : false,
    });
  }
  return resolved;
}

function parseArgs(argv) {
  const o = { maxSymbols: 40 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--max-symbols') o.maxSymbols = Number(argv[i + 1]);
    else if (argv[i] === '--staged') o.staged = true;
  }
  return o;
}

function main(argv, cwd) {
  const opts = parseArgs(argv);
  let symbols;
  try {
    symbols = candidateSymbols(cwd);
  } catch (err) {
    process.stderr.write(`dead-path-gate: ${err.message}\n`);
    return 2;
  }

  const examined = symbols.slice(0, opts.maxSymbols);
  if (symbols.length > examined.length) {
    // No silent caps: a bounded gate that reports full coverage is a lie.
    process.stdout.write(
      `dead-path: ${symbols.length} removed identifiers, examining the first ${examined.length} `
      + `(--max-symbols). ${symbols.length - examined.length} not checked.\n`);
  }

  const findings = classifyOrphans(resolve(cwd, examined));
  if (findings.length === 0) {
    process.stdout.write(`dead-path: clean (${examined.length} removed identifier(s) checked)\n`);
    return 0;
  }

  process.stdout.write(`dead-path: ${findings.length} orphaned definition(s)\n`);
  for (const f of findings) process.stdout.write(`  - ${f.message}\n`);
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2), process.cwd()));

module.exports = {
  candidateSymbols, definitionSite, isProduction, main, referenceCount, resolve,
};
