#!/usr/bin/env node

'use strict';

// Pre-commit half of gap G17 (legacy-discipline-proof). Composes with:
//  - coverage_map.py (unmodified) + record-coverage-verdict.js, which append
//    per-symbol receipts to specs/reviews/coverage-verdicts.jsonl whenever
//    checking-coverage-before-change's Step 2 runs.
//  - mutation-gate.js (G7), already re-verified independently that any new
//    test code in a commit actually bites — this gate does NOT duplicate that
//    (gap G29 adds a narrow, manual-commit-only backstop; see run()'s caller
//    in .claude/git-hooks/pre-commit and hooks/lib/legacy-bite-check.js).
//
// The Iron Law this gate proves was followed, mechanically, not just claimed:
//   NO EDIT TO A SYMBOL UNTIL YOU KNOW WHICH TESTS COVER IT
// For every STAGED, MODIFIED (not newly-added — a brand-new file is
// greenfield) production source file:
//   (a) no receipt covers the actually-changed line range (gap G29 Gap A: a
//       receipt for a DIFFERENT symbol/range in the same file no longer
//       counts) -> BLOCK (the coverage check never ran for this edit).
//   (b) the latest recorded verdict covering the changed range is UNCOVERED
//       -> the same commit must also stage a RELATED test-shaped file (gap
//       G29 Gap B: relatedness, not "any test file anywhere in the commit")
//       as evidence a pin-down or sprout happened -> BLOCK if missing.
// Degrades loudly, never silently-forever-blocking: a project with no
// specs/brownfield/code-graph.json, or a graph with no per-file symbol
// records (the regex-fallback producer — the same condition coverage_map.py
// itself exits 3 on), has no mechanical basis to check and is skipped with a
// note, exactly like checking-coverage-before-change Step 3 instructs for
// that case. Line-range data is only available from a real `git diff`
// (--staged mode); --files mode has no diff plumbing, so it falls back to
// the pre-G29 whole-file assumption — a disclosed, narrower-scope path, not
// a silent regression (see HARNESS.md G29).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isSource } = require('./ownership-check');
const { isTestFile } = require(path.join(__dirname, '..', 'hooks', 'lib', 'tdd'));
const { parseUnifiedDiffRanges } = require(path.join(__dirname, '..', 'hooks', 'lib', 'diff-hunks'));
const { hasRelatedEvidence } = require(path.join(__dirname, '..', 'hooks', 'lib', 'legacy-discipline-relatedness'));

const GRAPH_REL = path.join('specs', 'brownfield', 'code-graph.json');
const RECEIPTS_REL = path.join('specs', 'reviews', 'coverage-verdicts.jsonl');
const VERDICT_REL = path.join('specs', 'reviews', 'legacy-discipline-gate.json');
const MAP_REL = path.join('specs', 'design', 'component-map.md');

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

// changedRanges === null means "unknown" (no git diff data available, e.g.
// --files CLI mode) -> permissive whole-file fallback, the pre-G29 behavior.
// An empty ranges array (known, but no changed-range data for this file)
// overlaps nothing, so no receipt can cover it.
function overlapsChange(ranges, start, end) {
  if (ranges === null) return true;
  return ranges.some(([s, e]) => s <= end && e >= start);
}

// Receipt rows for one file whose [start,end] overlaps the file's actually-
// changed range (gap G29 Gap A).
function rowsCoveringChange(rows, ranges) {
  if (!rows) return [];
  return rows.filter((r) => overlapsChange(ranges, r.start, r.end));
}

// One file's verdict, pushed into the shared accumulator buckets. Split out
// of checkLegacyDiscipline's loop so each stays under the function-length cap.
function classifyFile(file, byFile, ranges, testFiles, mapText, buckets) {
  const covering = rowsCoveringChange(byFile.get(file), ranges);
  if (covering.length === 0) {
    buckets.noVerdict.push(file);
    return;
  }
  if (!covering.some((r) => r.verdict === 'UNCOVERED')) return;
  const evidence = hasRelatedEvidence(file, testFiles, mapText);
  if (!evidence.related) {
    buckets.uncoveredNoEvidence.push(file);
    return;
  }
  buckets.uncoveredEvidence.push({ file, tier: evidence.tier, testFiles });
  if (evidence.note) buckets.relatednessNotes.push(evidence.note);
}

// Pure core. modifiedProdFiles: staged+modified, source, non-test files.
// receipts: raw rows from coverage-verdicts.jsonl. allStaged: every staged
// path (any status), to look for pin-down/sprout test evidence.
// changedRanges: Map<file, [[s,e],...]> from a real git diff, or null when
// unavailable (gap G29 Gap A). mapText: component-map.md contents, or
// null/undefined when absent (gap G29 Gap B relatedness).
function checkLegacyDiscipline(modifiedProdFiles, receipts, allStaged, changedRanges, mapText) {
  const byFile = verdictsByFile(receipts);
  const testFiles = allStaged.filter((f) => isTestFile(f));
  const buckets = { noVerdict: [], uncoveredNoEvidence: [], uncoveredEvidence: [], relatednessNotes: [] };
  for (const file of modifiedProdFiles) {
    const ranges = changedRanges ? changedRanges.get(file) || [] : null;
    classifyFile(file, byFile, ranges, testFiles, mapText, buckets);
  }
  return {
    pass: buckets.noVerdict.length === 0 && buckets.uncoveredNoEvidence.length === 0,
    checked: modifiedProdFiles.length,
    ...buckets,
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

// Gap G29 Gap A: the actually-changed line ranges for staged files matching
// `filter`, keyed by new path. -U0 keeps the diff to just the changed hunks
// (no surrounding context lines to mis-parse as changed).
function gitDiffRanges(exec, filter) {
  const diffText = String(exec('git', ['diff', '--cached', '-U0', `--diff-filter=${filter}`]));
  return parseUnifiedDiffRanges(diffText);
}

function noGraphVerdict(root, note) {
  writeVerdict(root, { verdict: 'no-graph', pass: true, note });
  process.stdout.write(`legacy-discipline: SKIP (${note})\n`);
  return 0;
}

// The receipt this gate demands comes from coverage_map.py, which needs coverage data.
// A project with no coverage runner for the edited language cannot produce that data,
// so the discipline cannot be PERFORMED — and demanding proof it ran is incoherent,
// not strict. Same reasoning as coverage-preflight's tooling check; blocking on
// evidence the project cannot generate is an unsatisfiable wall, not a gate.
function coverageToolingMissing(root, modified) {
  if (modified.length === 0) return false;
  let canProduceCoverage;
  try {
    ({ canProduceCoverage } = require(path.join(__dirname, '..', 'hooks', 'lib', 'coverage-preflight')));
  } catch (_) {
    return false; // probe unavailable -> keep the historical strict behaviour
  }
  return !modified.some((f) => canProduceCoverage(root, f));
}

// Returns {modified, allStaged, changedRanges} from CLI args, or null on a
// usage error. --files has no git diff plumbing, so changedRanges is null
// (unknown -> whole-file fallback, disclosed in the file header).
function resolveFileSets(argv, exec, deps) {
  if (argv[0] === '--staged') {
    return {
      // MR, not just M: git's default rename detection reports a modified-
      // and-renamed file as status R (--name-only then returns its NEW path)
      // — filtering on M alone let a rename+edit dodge the receipt check.
      modified: gitDiffFiles(exec, 'MR').filter((f) => isSource(f) && !isTestFile(f)),
      allStaged: gitDiffFiles(exec, 'ACMR'),
      changedRanges: (deps && deps.changedRanges) || gitDiffRanges(exec, 'MR'),
    };
  }
  if (argv[0] === '--files') {
    const modified = argv.slice(1).filter((f) => isSource(f) && !isTestFile(f));
    return {
      modified,
      allStaged: (deps && deps.allStaged) || modified,
      changedRanges: (deps && deps.changedRanges) || null,
    };
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
  for (const n of verdict.relatednessNotes || []) process.stdout.write(`  note: ${n}\n`);
}

// component-map.md contents for Gap B relatedness, or null if the project
// has none yet (legacy-discipline-relatedness.js degrades to its own
// naming/commit-wide fallback in that case — see its file header).
function readMapText(root, deps) {
  if (deps && deps.mapText !== undefined) return deps.mapText;
  const mapPath = path.join(root, MAP_REL);
  return fs.existsSync(mapPath) ? fs.readFileSync(mapPath, 'utf8') : null;
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

  return evaluate(root, sets, deps);
}

function evaluate(root, sets, deps) {
  if (coverageToolingMissing(root, sets.modified)) {
    return noGraphVerdict(root,
      'no coverage runner in this project for the staged language(s) — the coverage ' +
      'verdict this gate requires cannot be produced, so the discipline is not checked. ' +
      'Add a coverage runner to enforce it.');
  }
  const verdict = checkLegacyDiscipline(
    sets.modified,
    readReceipts(root),
    sets.allStaged,
    sets.changedRanges,
    readMapText(root, deps)
  );
  writeVerdict(root, verdict);
  reportVerdict(verdict);
  return verdict.pass ? 0 : 1;
}

module.exports = {
  coverageToolingMissing,
  checkLegacyDiscipline,
  verdictsByFile,
  readReceipts,
  hasSymbolRecords,
  gitDiffRanges,
  resolveFileSets, // gap G30 (sprout-diff-gate.js): reused, not reimplemented
  readMapText, // gap G30 (sprout-diff-gate.js): reused, not reimplemented
  run,
  isSource,
  isTestFile,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
