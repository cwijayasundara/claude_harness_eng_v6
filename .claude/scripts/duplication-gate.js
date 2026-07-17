#!/usr/bin/env node
'use strict';

// Duplication ratchet — blocks a commit that adds a NEW code-clone occurrence
// above a grandfathered baseline. Mirrors coupling-gate.js's shape exactly
// (set-of-keys baseline, count-based block decision, names the new offenders).
// Wraps jscpd (a PATH binary); degrades LOUDLY (exit 0 + warning) when jscpd is
// absent. Invoked by: /gate, /auto Gate 4, and `npm run duplication-gate`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { cloneKeys } = require('../hooks/lib/duplication-gate');
const { gateDecision } = require('../hooks/lib/cycle-gate');

const REPO = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(REPO, '.claude', 'state', 'duplication-baseline.txt');
const IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**',
  '**/test/**', '**/tests/**', '**/*.test.js', '**/specs/**', '**/.claude/state/**',
];

function readBaseline() {
  try {
    return fs.readFileSync(BASELINE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) { return undefined; }
}

function writeBaseline(keys) {
  try {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, keys.length ? `${keys.join('\n')}\n` : '');
  } catch (_) { /* best effort */ }
}

function runJscpd(targets) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-'));
  const argv = ['jscpd', '--silent', '--reporters', 'json', '--output', out,
    ...IGNORE.flatMap((g) => ['--ignore', g]), ...targets];
  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: REPO, timeout: 120000 });
  if ((res.error && res.error.code === 'ENOENT') || res.status === 127) return { unavailable: true };
  try {
    return { report: JSON.parse(fs.readFileSync(path.join(out, 'jscpd-report.json'), 'utf8')) };
  } catch (_) {
    return { unavailable: true }; // ran but produced no parseable report — loud skip
  }
}

function blockMessage(d, added) {
  const lines = added.map((k) => `  - new clone occurrence in ${k.split(':').slice(1).join(':') || k}`);
  return [
    `duplication-gate: BLOCK — clone occurrences rose ${d.baseline} -> ${d.count}.`,
    'A change introduced new code duplication above the ratchet baseline.',
    ...lines,
    'Fix: extend the existing implementation or extract a shared function instead of copy-pasting.',
    'The baseline was NOT moved up. To grandfather intentional duplication, edit',
    '.claude/state/duplication-baseline.txt in a reviewed commit.',
    '',
  ].join('\n');
}

function main() {
  const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const { report, unavailable } = runJscpd(targets.length ? targets : ['.']);
  if (unavailable) {
    process.stdout.write('duplication-gate: jscpd not installed or unprovisioned — skipped (LOUD). Install jscpd to enable the clone ratchet.\n');
    process.exit(0);
  }
  const keys = cloneKeys(report);
  const baseline = readBaseline();
  const d = gateDecision(keys, baseline ? baseline.length : undefined);
  if (d.blocked) {
    const prev = new Set(baseline || []);
    process.stderr.write(blockMessage(d, keys.filter((k) => !prev.has(k))));
    process.exit(1);
  }
  writeBaseline(keys);
  process.stdout.write(`duplication-gate: PASS (${d.count} clone occurrences${d.baselineRun ? ', baseline established' : ''}).\n`);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { runJscpd, readBaseline, writeBaseline };
