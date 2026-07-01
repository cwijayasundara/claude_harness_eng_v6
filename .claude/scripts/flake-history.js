#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function commit(root) {
  try {
    return cp.execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function appendRows(historyPath, rows) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

function readHistory(historyPath) {
  if (!fs.existsSync(historyPath)) return [];
  return fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function rank(rows) {
  const byName = new Map();
  for (const row of rows) {
    const prev = byName.get(row.name) || { name: row.name, occurrences: 0, passed: 0, failed: 0, last_seen: row.date };
    prev.occurrences += 1;
    prev.passed += row.passed || 0;
    prev.failed += row.failed || 0;
    if (String(row.date) > String(prev.last_seen)) prev.last_seen = row.date;
    byName.set(row.name, prev);
  }
  return [...byName.values()].sort((a, b) => b.occurrences - a.occurrences || b.failed - a.failed || a.name.localeCompare(b.name));
}

function renderMd(rows) {
  const ranked = rank(rows);
  const lines = ['# Flake History', '', '| Test | Occurrences | Failed | Passed | Last Seen |', '|---|---:|---:|---:|---|'];
  if (!ranked.length) lines.push('| None | 0 | 0 | 0 | - |');
  for (const r of ranked) lines.push(`| ${r.name} | ${r.occurrences} | ${r.failed} | ${r.passed} | ${r.last_seen} |`);
  return `${lines.join('\n')}\n`;
}

function run(argv = process.argv.slice(2), root = process.cwd()) {
  const reportPath = arg(argv, '--report', path.join(root, 'specs', 'reports', 'flake-report.json'));
  const historyPath = arg(argv, '--history', path.join(root, 'specs', 'drift', 'flake-history.jsonl'));
  const mdPath = arg(argv, '--out', path.join(root, 'specs', 'drift', 'flake-history.md'));
  const date = arg(argv, '--date', new Date().toISOString().slice(0, 10));
  const gitCommit = arg(argv, '--commit', commit(root));
  if (!fs.existsSync(reportPath)) {
    process.stdout.write('flake-history: no report found; skipping\n');
    return 0;
  }
  const report = readJson(reportPath);
  const flakes = Array.isArray(report.flakes) ? report.flakes : [];
  const rows = flakes.map((f) => ({
    date,
    commit: gitCommit,
    name: f.name,
    passed: f.passed || 0,
    failed: f.failed || 0,
  }));
  appendRows(historyPath, rows);
  const allRows = readHistory(historyPath);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, renderMd(allRows));
  process.stdout.write(`flake-history: recorded ${rows.length} flake(s)\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`flake-history: ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { rank, renderMd, run };
