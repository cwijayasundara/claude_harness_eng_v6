#!/usr/bin/env node

'use strict';

// Gap G30: mechanical verification of sprouting-instead-of-editing's Iron
// Law — "IF YOU CANNOT PIN IT, DO NOT EDIT IT — SPROUT BESIDE IT", and its
// Process step 2: "Touch the legacy file at exactly one call line (or the
// rename pair for wrap)." Until now this was prompt-level only, the exact
// forward item HARNESS.md's G17 entry disclosed and left unbuilt ("mechanically
// verifying sprouting-instead-of-editing's one-symbol legacy-diff constraint
// against code-graph.json symbol ranges remains an optional follow-on").
//
// Fires ONLY for a commit legacy-discipline-gate.js (G17/G29) already
// classified as UNCOVERED-with-evidence on an existing file, where that
// evidence is a SPROUT — a genuinely NEW production file staged alongside
// the legacy touch — rather than a PIN-DOWN, which only adds/modifies test
// files and has no one-symbol constraint of its own (hooks/lib/sprout-
// classify.js's job). For each sprout-classified legacy file, the staged
// diff's changed line ranges (hooks/lib/diff-hunks.js, reused, not
// reimplemented) are checked against code-graph.json's per-file symbol
// ranges (hooks/lib/sprout-symbol-check.js): more than 2 distinct symbols
// touched (1 for a plain sprout call line, up to 2 for a legitimate wrap
// rename pair — sprouting-instead-of-editing's own Process step 2 names
// that exception) BLOCKs, naming the extra symbol(s).
//
// Degrades loudly, never silently, mirroring legacy-discipline-gate.js's own
// noGraphVerdict/hasSymbolRecords conventions exactly: no code-graph.json, a
// regex-fallback graph with no per-file symbol records, no per-file symbol
// record for a specific candidate, or unavailable changed-range data
// (--files CLI mode) all SKIP with a note rather than block.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const legacyGate = require('./legacy-discipline-gate');
const { classifySprout } = require(path.join(__dirname, '..', 'hooks', 'lib', 'sprout-classify'));
const { symbolsTouchedByRanges } = require(path.join(__dirname, '..', 'hooks', 'lib', 'sprout-symbol-check'));

const GRAPH_REL = path.join('specs', 'brownfield', 'code-graph.json');
const VERDICT_REL = path.join('specs', 'reviews', 'sprout-diff-gate.json');
const MAX_TOUCHED_SYMBOLS = 2; // 1 for a sprout call line, up to 2 for a wrap rename pair

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// One UNCOVERED-with-evidence candidate, classified and (if sprout-shaped)
// checked against the legacy file's actual changed-line/symbol overlap.
// Mutates `buckets`; returns nothing — split out of checkSproutDiff's loop
// so both functions stay under the harness's 30-line function cap.
function classifyAndCheckOne(candidate, addedProdFiles, changedRanges, filesByPath, mapText, buckets) {
  const file = candidate.file;
  const classified = classifySprout(file, addedProdFiles, mapText);
  if (!classified.isSprout) {
    buckets.pinDownSkipped.push(file);
    return;
  }
  if (classified.note) buckets.classifyNotes.push(classified.note);
  const record = filesByPath.get(file);
  if (!record) {
    buckets.noSymbolRecord.push(file);
    return;
  }
  const ranges = changedRanges ? changedRanges.get(file) || [] : null;
  const touched = symbolsTouchedByRanges(record, ranges);
  if (touched === null) {
    buckets.unverifiableRanges.push(file);
    return;
  }
  if (touched.length > MAX_TOUCHED_SYMBOLS) buckets.violations.push({ file, symbols: touched });
  else if (touched.length === MAX_TOUCHED_SYMBOLS) buckets.assumedWrapPairs.push({ file, symbols: touched });
  else buckets.cleanPasses.push(file);
}

function skipNote(candidates) {
  return candidates.length === 0
    ? 'no UNCOVERED-with-evidence legacy file in this commit — nothing sprout-shaped to check'
    : 'UNCOVERED-with-evidence file(s) present, but no new production file staged alongside them — pin-down shape, not sprout';
}

// Pure core. candidates: legacy-discipline-gate.js's checkLegacyDiscipline
// output `uncoveredEvidence` array ({file, tier, testFiles}). addedProdFiles:
// staged, added (diff-filter=A), source, non-test files in this commit.
// changedRanges: Map<file, [[s,e],...]> from a real git diff, or null when
// unavailable. graph: the parsed code-graph.json. mapText: component-map.md
// contents, or null/undefined when absent.
function checkSproutDiff(candidates, addedProdFiles, changedRanges, graph, mapText) {
  const filesByPath = new Map((graph.files || []).map((f) => [f.path, f]));
  const buckets = {
    violations: [], assumedWrapPairs: [], cleanPasses: [], classifyNotes: [],
    noSymbolRecord: [], unverifiableRanges: [], pinDownSkipped: [],
  };
  for (const candidate of candidates) {
    classifyAndCheckOne(candidate, addedProdFiles, changedRanges, filesByPath, mapText, buckets);
  }
  const sproutCandidateCount = candidates.length - buckets.pinDownSkipped.length;
  return {
    pass: buckets.violations.length === 0,
    checked: buckets.violations.length + buckets.assumedWrapPairs.length + buckets.cleanPasses.length,
    sproutCandidateCount,
    note: sproutCandidateCount === 0 ? skipNote(candidates) : null,
    ...buckets,
  };
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function noGraphVerdict(root, note) {
  writeVerdict(root, { verdict: 'no-graph', pass: true, note });
  process.stdout.write(`sprout-diff: SKIP (${note})\n`);
  return 0;
}

function reportVerdict(verdict) {
  if (verdict.sproutCandidateCount === 0) {
    process.stdout.write(`sprout-diff: SKIP (${verdict.note})\n`);
    return;
  }
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(
    `sprout-diff: ${label} — ${verdict.checked}/${verdict.sproutCandidateCount} sprout-shaped legacy file(s) verified, ` +
      `${verdict.violations.length} violation(s)\n`
  );
  for (const v of verdict.violations) {
    process.stdout.write(`  TOO MANY SYMBOLS TOUCHED   ${v.file} — ${v.symbols.join(', ')}\n`);
  }
  for (const w of verdict.assumedWrapPairs) {
    process.stdout.write(
      `  note: ${w.file} touches 2 symbols (${w.symbols.join(', ')}) — assumed wrap-rename pair, not independently verified\n`
    );
  }
  for (const f of verdict.noSymbolRecord) process.stdout.write(`  note: no per-file symbol record for ${f}\n`);
  for (const f of verdict.unverifiableRanges) process.stdout.write(`  note: changed-range data unavailable for ${f}\n`);
  for (const n of verdict.classifyNotes) process.stdout.write(`  note: ${n}\n`);
}

// Staged, added (diff-filter=A), source, non-test files — the sprout
// signal. Independent of --staged/--files mode: git already knows what's
// staged regardless of which file-list argv passed in.
function gitAddedProdFiles(exec) {
  return String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=A']))
    .split('\n')
    .filter(Boolean)
    .filter((f) => legacyGate.isSource(f) && !legacyGate.isTestFile(f));
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  const graphPath = path.join(root, GRAPH_REL);
  if (!fs.existsSync(graphPath)) return noGraphVerdict(root, `${GRAPH_REL} not found — sprout-diff not checked`);
  const graph = readJson(graphPath);
  if (!legacyGate.hasSymbolRecords(graph)) {
    return noGraphVerdict(root, `${GRAPH_REL} has no per-file symbol records — sprout-diff not checked`);
  }

  const sets = legacyGate.resolveFileSets(argv, exec, deps);
  if (!sets) {
    process.stderr.write('usage: sprout-diff-gate.js --staged | --files <path> [...]\n');
    return 2;
  }
  const mapText = legacyGate.readMapText(root, deps);
  const legacyVerdict = legacyGate.checkLegacyDiscipline(
    sets.modified, legacyGate.readReceipts(root), sets.allStaged, sets.changedRanges, mapText
  );
  const addedProdFiles = (deps && deps.addedProdFiles) || gitAddedProdFiles(exec);

  const verdict = checkSproutDiff(legacyVerdict.uncoveredEvidence || [], addedProdFiles, sets.changedRanges, graph, mapText);
  writeVerdict(root, verdict);
  reportVerdict(verdict);
  return verdict.pass ? 0 : 1;
}

module.exports = { checkSproutDiff, gitAddedProdFiles, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
