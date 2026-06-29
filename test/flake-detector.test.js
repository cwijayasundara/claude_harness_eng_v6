'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'flake-detector.js');
const { parseTap, aggregateFlakes } = require('../.claude/scripts/flake-detector.js');

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
