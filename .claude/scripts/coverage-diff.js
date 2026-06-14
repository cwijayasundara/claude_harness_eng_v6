#!/usr/bin/env node

'use strict';

// Per-diff coverage gate. The repo-wide ratchet (/auto Gate 3) can rise while a
// group ships dark code — other files carry the average. This measures coverage
// over only the files the current group changed, so new untested code is caught
// at the diff level, and appends each result to a coverage-history.jsonl trend.
//
// Consumes the two coverage shapes the harness's stacks emit:
//   - Istanbul/nyc/vitest `coverage-summary.json` (per-file `.lines`)
//   - Python `coverage json` output (per-file `.summary`)
//
// Dependency-free and deterministic.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function toForward(p) {
  return String(p).replace(/\\/g, '/');
}

// Returns { "<file>": { covered, total } } for either coverage shape.
function normalizeCoverage(json) {
  const out = {};
  if (json && json.files && typeof json.files === 'object') {
    for (const [file, data] of Object.entries(json.files)) {
      const s = data.summary || {};
      out[toForward(file)] = { covered: s.covered_lines || 0, total: s.num_statements || 0 };
    }
    return out;
  }
  for (const [file, data] of Object.entries(json || {})) {
    if (file === 'total') continue;
    const m = (data && (data.lines || data.statements)) || null;
    if (m) out[toForward(file)] = { covered: m.covered || 0, total: m.total || 0 };
  }
  return out;
}

// A coverage key matches a changed file when one path ends with the other on a
// segment boundary (handles absolute coverage keys vs repo-relative diff paths).
function matchKey(keys, changed) {
  const c = toForward(changed);
  return keys.find((k) => k === c || k.endsWith('/' + c) || c.endsWith('/' + k));
}

function computeDiffCoverage(normalized, changedFiles) {
  const keys = Object.keys(normalized);
  const files = [];
  let covered = 0;
  let total = 0;
  for (const changed of changedFiles || []) {
    const key = matchKey(keys, changed);
    if (!key) continue;
    const m = normalized[key];
    covered += m.covered;
    total += m.total;
    files.push({ file: key, covered: m.covered, total: m.total, pct: m.total ? (m.covered / m.total) * 100 : null });
  }
  return { files, covered, total, matched: files.length, pct: total ? (covered / total) * 100 : null };
}

// --- CLI -----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--files') args.files.push(argv[++i]);
    else if (k && k.startsWith('--')) args[k.slice(2)] = argv[++i];
  }
  return args;
}

function changedFromGit(base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function appendHistory(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.coverage || !fs.existsSync(args.coverage)) {
    process.stderr.write('usage: coverage-diff.js --coverage <summary.json> (--files <f>... | --diff-base <ref>) ' +
      '[--floor 80] [--history <file>] [--label <id>] [--stamp <iso>]\n');
    process.exit(2);
  }
  const floor = args.floor != null ? parseFloat(args.floor) : 80;
  const changed = args.files.length ? args.files : (args['diff-base'] ? changedFromGit(args['diff-base']) : []);
  const json = JSON.parse(fs.readFileSync(args.coverage, 'utf8'));
  const r = computeDiffCoverage(normalizeCoverage(json), changed);
  const pass = r.pct == null ? true : r.pct >= floor;
  if (args.history) {
    appendHistory(args.history, { at: args.stamp || new Date().toISOString(), label: args.label || null,
      pct: r.pct, covered: r.covered, total: r.total, matched: r.matched, floor, pass });
  }
  const pctText = r.pct == null ? 'n/a (no measured files changed)' : `${r.pct.toFixed(1)}%`;
  process.stdout.write(`coverage-diff: ${pass ? 'PASS' : 'FAIL'} — ${pctText} over ${r.matched} changed file(s), floor ${floor}%\n`);
  for (const f of r.files) if (f.pct != null && f.pct < floor) process.stdout.write(`  LOW ${f.file} ${f.pct.toFixed(1)}%\n`);
  process.exit(pass ? 0 : 1);
}

module.exports = { normalizeCoverage, computeDiffCoverage };

if (require.main === module) main();
