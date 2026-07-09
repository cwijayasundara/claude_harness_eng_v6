#!/usr/bin/env node

'use strict';

// Verdict-recording half of gap G17 (legacy-discipline-proof). Three of the
// four legacy-preservation discipline skills — checking-coverage-before-change,
// pinning-down-behavior, sprouting-instead-of-editing — were prompt-level
// instructions only: nothing proved the Iron Law ("no edit to a symbol until
// you know which tests cover it") actually ran before a symbol was edited.
// checking-coverage-before-change's Step 2 now pipes coverage_map.py's JSON
// report through this wrapper so legacy-discipline-gate.js (the pre-commit
// half) can later prove a verdict was obtained for a file before it was
// edited, not just trust an agent's claim.
//
// Read-through by design: stdin is echoed to stdout byte-for-byte BEFORE any
// parsing is attempted, so this wrapper can never turn a working skill step
// into a broken pipe — recording is a side effect, never a filter.
//
// CLI: coverage_map.py ... | node .claude/scripts/record-coverage-verdict.js
//        [--root DIR] [--out specs/reviews/coverage-verdicts.jsonl]

const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.join('specs', 'reviews', 'coverage-verdicts.jsonl');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function resolveOutPath(root, argv) {
  const out = arg(argv, '--out', DEFAULT_OUT);
  return path.isAbsolute(out) ? out : path.join(root, out);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

// Pure core: a coverage_map.py report -> receipt rows. Exported for tests.
function receiptRows(report, recordedAt) {
  if (!report || !Array.isArray(report.results)) return [];
  return report.results.map((r) => ({
    path: r.path,
    symbol: r.symbol,
    start: r.start,
    end: r.end,
    verdict: r.verdict,
    tests: r.tests || [],
    recordedAt,
  }));
}

function appendRows(outPath, rows) {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(outPath, lines);
}

function run(argv, deps) {
  const readIn = (deps && deps.readStdin) || readStdin;
  const now = (deps && deps.now) || (() => new Date().toISOString());
  const root = arg(argv, '--root', process.cwd());
  const outPath = resolveOutPath(root, argv);

  const raw = readIn();
  process.stdout.write(raw); // pass-through first: recording must never block the pipe

  let report = null;
  try {
    report = raw.trim() ? JSON.parse(raw) : null;
  } catch (_) {
    process.stderr.write(
      'record-coverage-verdict: stdin was not valid JSON — nothing recorded (pass-through only).\n'
    );
    return 0;
  }
  if (!report) return 0;

  appendRows(outPath, receiptRows(report, now()));
  return 0;
}

module.exports = { receiptRows, appendRows, resolveOutPath, run };

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
