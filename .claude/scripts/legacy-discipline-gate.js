#!/usr/bin/env node

'use strict';

// Pre-commit half of gap G17 (legacy-discipline-proof). Composes with:
//  - coverage_map.py (unmodified) + record-coverage-verdict.js, which append
//    per-symbol receipts to specs/reviews/coverage-verdicts.jsonl whenever
//    checking-coverage-before-change's Step 2 runs.
//  - mutation-gate.js (G7), already re-verified independently that any new
//    test code in a commit actually bites — this gate does NOT duplicate that.
//
// The Iron Law this gate proves was followed, mechanically, not just claimed:
//   NO EDIT TO A SYMBOL UNTIL YOU KNOW WHICH TESTS COVER IT
// For every STAGED, MODIFIED (not newly-added — a brand-new file is
// greenfield) production source file:
//   (a) no receipt was ever recorded for the file -> BLOCK (the coverage
//       check never ran before the edit).
//   (b) the latest recorded verdict for a symbol in the file is UNCOVERED ->
//       the same commit must also stage a new/modified test-shaped file as
//       evidence a pin-down or sprout happened, not a raw edit -> BLOCK if
//       missing.
// Degrades loudly, never silently-forever-blocking: a project with no
// specs/brownfield/code-graph.json, or a graph with no per-file symbol
// records (the regex-fallback producer — the same condition coverage_map.py
// itself exits 3 on), has no mechanical basis to check and is skipped with a
// note, exactly like checking-coverage-before-change Step 3 instructs for
// that case.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isSource } = require('./ownership-check');
const { isTestFile } = require(path.join(__dirname, '..', 'hooks', 'lib', 'tdd'));

const GRAPH_REL = path.join('specs', 'brownfield', 'code-graph.json');
const RECEIPTS_REL = path.join('specs', 'reviews', 'coverage-verdicts.jsonl');
const VERDICT_REL = path.join('specs', 'reviews', 'legacy-discipline-gate.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// Symbol records exist only from the vendored-ast producer (code_index.py);
// the regex fallback graph has no `files` records, same guard coverage_map.py
// itself applies before exiting 3.
function hasSymbolRecords(graph) {
  return Array.isArray(graph && graph.files) && graph.files.some((f) => (f.symbols || []).length > 0);
}

function readReceipts(root) {
  const p = path.join(root, RECEIPTS_REL);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

// Latest-wins per (path, symbol): a symbol recorded UNCOVERED once and
// COVERED later (after a pin-down made it observable) must read as COVERED.
function verdictsByFile(receipts) {
  const latest = new Map();
  for (const r of receipts) {
    if (!r || !r.path || !r.symbol) continue;
    const key = `${r.path}#${r.symbol}`;
    const prev = latest.get(key);
    if (!prev || String(r.recordedAt) >= String(prev.recordedAt)) latest.set(key, r);
  }
  const byFile = new Map();
  for (const row of latest.values()) {
    const list = byFile.get(row.path) || [];
    list.push(row);
    byFile.set(row.path, list);
  }
  return byFile;
}

// Pure core. modifiedProdFiles: staged+modified, source, non-test files.
// receipts: raw rows from coverage-verdicts.jsonl. allStaged: every staged
// path (any status), to look for pin-down/sprout test evidence.
function checkLegacyDiscipline(modifiedProdFiles, receipts, allStaged) {
  const byFile = verdictsByFile(receipts);
  const hasTestEvidence = allStaged.some((f) => isTestFile(f));
  const noVerdict = [];
  const uncoveredNoEvidence = [];
  for (const file of modifiedProdFiles) {
    const rows = byFile.get(file);
    if (!rows || rows.length === 0) {
      noVerdict.push(file);
      continue;
    }
    if (rows.some((r) => r.verdict === 'UNCOVERED') && !hasTestEvidence) {
      uncoveredNoEvidence.push(file);
    }
  }
  return {
    pass: noVerdict.length === 0 && uncoveredNoEvidence.length === 0,
    checked: modifiedProdFiles.length,
    noVerdict,
    uncoveredNoEvidence,
  };
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function gitDiffFiles(exec, filter) {
  return String(exec('git', ['diff', '--cached', '--name-only', `--diff-filter=${filter}`]))
    .split('\n')
    .filter(Boolean);
}

function noGraphVerdict(root, note) {
  writeVerdict(root, { verdict: 'no-graph', pass: true, note });
  process.stdout.write(`legacy-discipline: SKIP (${note})\n`);
  return 0;
}

// Returns {modified, allStaged} from CLI args, or null on a usage error.
function resolveFileSets(argv, exec, deps) {
  if (argv[0] === '--staged') {
    return {
      // MR, not just M: git's default rename detection reports a modified-
      // and-renamed file as status R (--name-only then returns its NEW path)
      // — filtering on M alone let a rename+edit dodge the receipt check.
      modified: gitDiffFiles(exec, 'MR').filter((f) => isSource(f) && !isTestFile(f)),
      allStaged: gitDiffFiles(exec, 'ACMR'),
    };
  }
  if (argv[0] === '--files') {
    const modified = argv.slice(1).filter((f) => isSource(f) && !isTestFile(f));
    return { modified, allStaged: (deps && deps.allStaged) || modified };
  }
  return null;
}

function reportVerdict(verdict) {
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(
    `legacy-discipline: ${label} — ${verdict.checked} checked, ${verdict.noVerdict.length} no-verdict, ` +
      `${verdict.uncoveredNoEvidence.length} unproven\n`
  );
  for (const f of verdict.noVerdict) process.stdout.write(`  NO VERDICT RECORDED       ${f}\n`);
  for (const f of verdict.uncoveredNoEvidence) process.stdout.write(`  UNCOVERED, NO TEST STAGED ${f}\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  const graphPath = path.join(root, GRAPH_REL);
  if (!fs.existsSync(graphPath)) return noGraphVerdict(root, `${GRAPH_REL} not found — legacy-discipline not checked`);
  const graph = readJson(graphPath);
  if (!hasSymbolRecords(graph)) {
    return noGraphVerdict(root, `${GRAPH_REL} has no per-file symbol records — legacy-discipline not checked`);
  }

  const sets = resolveFileSets(argv, exec, deps);
  if (!sets) {
    process.stderr.write('usage: legacy-discipline-gate.js --staged | --files <path> [...]\n');
    return 2;
  }

  const verdict = checkLegacyDiscipline(sets.modified, readReceipts(root), sets.allStaged);
  writeVerdict(root, verdict);
  reportVerdict(verdict);
  return verdict.pass ? 0 : 1;
}

module.exports = {
  checkLegacyDiscipline,
  verdictsByFile,
  readReceipts,
  hasSymbolRecords,
  run,
  isSource,
  isTestFile,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
