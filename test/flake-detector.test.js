'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'flake-detector.js');
const { parseTap, aggregateFlakes, parsePlaywrightJson } = require('../.claude/scripts/flake-detector.js');

test('parseTap reads ok/not ok lines, strips directives, ignores plan/comments', () => {
  const tap = 'TAP version 13\n1..2\nok 1 - a\nnot ok 2 - b # AssertionError\n# a comment\n';
  assert.deepStrictEqual(parseTap(tap), { a: 'ok', b: 'not ok' });
});

test('aggregateFlakes flags a test that both passed and failed', () => {
  const perRun = [{ t: 'ok' }, { t: 'not ok' }, { t: 'ok' }, { s: 'ok' }];
  const flakes = aggregateFlakes(perRun);
  assert.deepStrictEqual(flakes, [{ name: 't', passed: 2, failed: 1 }]); // s is consistent -> not a flake
});

// CLI: a deterministically-flaky fake command (alternates ok/not ok by a counter file).
function flakyFake(dir) {
  const p = path.join(dir, 'flaky.sh');
  fs.writeFileSync(p,
    '#!/bin/sh\n' +
    'C=$(cat "$PWD/counter" 2>/dev/null || echo 0)\n' +
    'echo $((C+1)) > "$PWD/counter"\n' +
    'echo "TAP version 13"; echo "1..1"\n' +
    'if [ $((C % 2)) -eq 0 ]; then echo "ok 1 - flaky test"; else echo "not ok 1 - flaky test"; fi\n');
  return p;
}

function runDetector(dir, testCmd, runs) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir, '--test-cmd', testCmd, '--runs', String(runs)], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reports', 'flake-report.json'), 'utf8'));
  return { code, r };
}

test('CLI detects a flaky test across runs -> exit 1, names it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const { code, r } = runDetector(dir, `sh ${flakyFake(dir)}`, 4);
  assert.strictEqual(code, 1);
  assert.strictEqual(r.flakes.length, 1);
  assert.strictEqual(r.flakes[0].name, 'flaky test');
  assert.strictEqual(r.all_consistent, false);
});

test('CLI on a deterministic-pass command -> exit 0, no flakes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const stable = path.join(dir, 'stable.sh');
  fs.writeFileSync(stable, '#!/bin/sh\necho "TAP version 13"; echo "1..1"; echo "ok 1 - stable"\n');
  const { code, r } = runDetector(dir, `sh ${stable}`, 3);
  assert.strictEqual(code, 0);
  assert.strictEqual(r.flakes.length, 0);
  assert.strictEqual(r.all_consistent, true);
});

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('parsePlaywrightJson: builds an {title: ok|not ok} map from a real playwright JSON report', () => {
  // Same captured-shape fixture regression-gate.test.js uses for
  // extractPlaywrightFailures — one flat spec file, one nested describe.
  const report = {
    suites: [
      { title: 'sample.spec.js', file: 'sample.spec.js', specs: [
        { title: 'passing test', ok: true, file: 'sample.spec.js', line: 2 },
        { title: 'failing test', ok: false, file: 'sample.spec.js', line: 5 },
      ] },
    ],
  };
  const map = parsePlaywrightJson(JSON.stringify(report));
  assert.deepStrictEqual(map, { 'passing test': 'ok', 'failing test': 'not ok' });
});

test('parsePlaywrightJson: unparseable stdout returns null (errored run, same as TAP)', () => {
  assert.strictEqual(parsePlaywrightJson('not json at all'), null);
});

// CLI: a deterministically-flaky fake Playwright reporter (alternates
// ok/false by a counter file, same technique flakyFake uses for TAP).
function flakyPlaywrightFake(dir) {
  const p = path.join(dir, 'flaky-e2e.sh');
  fs.writeFileSync(p,
    '#!/bin/sh\n' +
    'C=$(cat "$PWD/counter" 2>/dev/null || echo 0)\n' +
    'echo $((C+1)) > "$PWD/counter"\n' +
    'if [ $((C % 2)) -eq 0 ]; then OK=true; else OK=false; fi\n' +
    'echo "{\\"suites\\":[{\\"title\\":\\"sample.spec.js\\",\\"file\\":\\"sample.spec.js\\",' +
    '\\"specs\\":[{\\"title\\":\\"flaky e2e test\\",\\"ok\\":$OK,\\"file\\":\\"sample.spec.js\\",\\"line\\":2}]}]}"\n');
  return p;
}

function runDetectorE2e(dir, testCmd, runs) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir, '--e2e', '--test-cmd', testCmd, '--runs', String(runs)], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reports', 'flake-report.json'), 'utf8'));
  return { code, r };
}

test('CLI --e2e mode detects a flaky Playwright spec across runs -> exit 1, names it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-e2e-'));
  const { code, r } = runDetectorE2e(dir, `sh ${flakyPlaywrightFake(dir)}`, 4);
  assert.strictEqual(code, 1);
  assert.strictEqual(r.flakes.length, 1);
  assert.strictEqual(r.flakes[0].name, 'flaky e2e test');
  assert.strictEqual(r.all_consistent, false);
});

test('CLI --e2e mode on a deterministic-pass Playwright report -> exit 0, no flakes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-e2e-'));
  const stable = path.join(dir, 'stable-e2e.sh');
  fs.writeFileSync(stable, '#!/bin/sh\necho \'{"suites":[{"title":"a.spec.js","file":"a.spec.js","specs":[{"title":"stable e2e","ok":true,"file":"a.spec.js","line":1}]}]}\'\n');
  const { code, r } = runDetectorE2e(dir, `sh ${stable}`, 3);
  assert.strictEqual(code, 0);
  assert.strictEqual(r.flakes.length, 0);
  assert.strictEqual(r.all_consistent, true);
});

test('CLI --e2e mode: unparseable output across all runs -> exit 2, no completed runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-e2e-'));
  const broken = path.join(dir, 'broken-e2e.sh');
  fs.writeFileSync(broken, '#!/bin/sh\necho "not json"\n');
  const { code, r } = runDetectorE2e(dir, `sh ${broken}`, 2);
  assert.strictEqual(code, 2);
  assert.strictEqual(r.completed_runs, 0);
  assert.strictEqual(r.errored_runs, 2);
});

test('G12: flake-detection is scripted + registered active (drift cadence)', () => {
  assert.strictEqual(JSON.parse(rd('package.json')).scripts.flakes, 'node .claude/scripts/flake-detector.js');
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'flake-detection');
  assert.ok(s, 'flake-detection sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.cadence, 'drift');
  assert.strictEqual(s.scope, 'repo');
  assert.ok(s.wired_at && fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
});
