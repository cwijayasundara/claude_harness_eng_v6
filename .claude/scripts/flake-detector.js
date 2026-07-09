#!/usr/bin/env node

'use strict';

// Flake detection (gap G12, slice 4; e2e mode added gap G28). Runs a test
// command N times and reports tests that BOTH passed and failed across runs
// (flakes). Drift cadence, opt-in (npm run flakes / /schedule), non-blocking
// — never a /gate or /auto gate. Two modes:
//   - default: parses node:test TAP per run.
//   - --e2e: runs a Playwright command per run and parses its
//     `--reporter=json` output via regression-gate.js's extractPlaywrightResults
//     (gap G15's tree-walk, reused rather than reimplemented).
// Errored runs (timeout / no parseable output) are excluded from aggregation
// in both modes.
//
// CLI: node .claude/scripts/flake-detector.js [--test-cmd CMD] [--runs N]
//        [--timeout MS] [--out FILE] [--root DIR] [--e2e]
// Exit 0 = no flakes; 1 = flakes found; 2 = no run produced parseable results.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractPlaywrightResults } = require('../hooks/lib/regression-gate.js');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

// node:test TAP: `ok N - name` / `not ok N - name` (strip a trailing ` # directive`).
function parseTap(stdout) {
  const out = {};
  for (const line of String(stdout).split('\n')) {
    const m = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.*)$/);
    if (!m) continue;
    const name = m[2].replace(/\s+#.*$/, '').trim();
    if (name) out[name] = m[1];
  }
  return out;
}

// A test is a flake iff it passed in >=1 run AND failed in >=1 run.
function aggregateFlakes(perRun) {
  const pass = {};
  const fail = {};
  for (const run of perRun) {
    for (const [name, status] of Object.entries(run)) {
      if (status === 'ok') pass[name] = (pass[name] || 0) + 1;
      else fail[name] = (fail[name] || 0) + 1;
    }
  }
  const flakes = [];
  for (const name of new Set([...Object.keys(pass), ...Object.keys(fail)])) {
    if ((pass[name] || 0) > 0 && (fail[name] || 0) > 0) flakes.push({ name, passed: pass[name], failed: fail[name] });
  }
  return flakes.sort((a, b) => (a.name < b.name ? -1 : 1));
}

function runOnce(cmd, root, timeout) {
  const res = spawnSync(cmd, { cwd: root, shell: true, timeout, encoding: 'utf8' });
  if (res.error || res.signal === 'SIGTERM') return null; // spawn error or timeout -> errored run
  const map = parseTap((res.stdout || '') + '\n' + (res.stderr || ''));
  return Object.keys(map).length ? map : null;
}

// Parses a `playwright test --reporter=json` run's stdout into the same
// {title: 'ok'|'not ok'} shape parseTap produces, via extractPlaywrightResults
// (gap G15's tree-walk). Unparseable JSON is treated as an errored run, same
// as a spawn error or timeout.
function parsePlaywrightJson(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (e) {
    return null;
  }
  const map = {};
  for (const result of extractPlaywrightResults(report)) {
    map[result.title] = result.ok ? 'ok' : 'not ok';
  }
  return map;
}

function runOnceE2e(cmd, root, timeout) {
  const res = spawnSync(cmd, { cwd: root, shell: true, timeout, encoding: 'utf8' });
  if (res.error || res.signal === 'SIGTERM') return null; // spawn error or timeout -> errored run
  const map = parsePlaywrightJson(res.stdout || '');
  return map && Object.keys(map).length ? map : null;
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const isE2e = argv.includes('--e2e');
  const cmd = arg(argv, '--test-cmd', isE2e ? 'npx playwright test --reporter=json' : 'npm test');
  const runs = parseInt(arg(argv, '--runs', '5'), 10);
  const timeout = parseInt(arg(argv, '--timeout', '600000'), 10);
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reports', 'flake-report.json'));
  const perRun = [];
  let errored = 0;
  for (let i = 0; i < runs; i++) {
    const map = isE2e ? runOnceE2e(cmd, root, timeout) : runOnce(cmd, root, timeout);
    if (map) perRun.push(map); else errored++;
  }
  const flakes = aggregateFlakes(perRun);
  const report = { runs, completed_runs: perRun.length, errored_runs: errored, flakes, all_consistent: flakes.length === 0 };
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  } catch (e) { process.stderr.write(`flake-detector: could not write report: ${e.message}\n`); }
  process.stdout.write(`flake-detector: ${flakes.length} flake(s) over ${perRun.length}/${runs} completed runs (${errored} errored)` + (flakes.length ? ': ' + flakes.map((f) => f.name).join(', ') : '') + '\n');
  process.exit(perRun.length === 0 ? 2 : flakes.length > 0 ? 1 : 0);
}

module.exports = { parseTap, aggregateFlakes, parsePlaywrightJson };

if (require.main === module) main();
