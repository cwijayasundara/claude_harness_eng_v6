'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const runner = require(path.join(ROOT, 'test', 'e2e', 'run-pack.js'));

test('e2e pack exposes the expected profiles', () => {
  assert.deepStrictEqual(Object.keys(runner.PROFILES).sort(), ['all', 'cert', 'fast', 'live', 'smoke']);
  assert.deepStrictEqual(runner.PROFILES.fast.map((l) => l.id), ['fast-contracts']);
  assert.ok(runner.PROFILES.live.some((l) => l.id === 'plan'));
  assert.ok(runner.PROFILES.live.some((l) => l.id === 'semi'));
  assert.ok(runner.PROFILES.live.some((l) => l.id === 'auto'));
  assert.ok(runner.PROFILES.live.some((l) => l.id === 'smoke'));
  assert.ok(runner.PROFILES.cert.some((l) => l.id === 'brownfield'));
});

test('e2e pack supports --only and --skip selection', () => {
  const only = runner.selectedLayers(runner.parseArgs(['live', '--only', 'plan,auto']));
  assert.deepStrictEqual(only.map((l) => l.id), ['plan', 'auto']);

  const skip = runner.selectedLayers(runner.parseArgs(['live', '--skip=semi,smoke']));
  assert.deepStrictEqual(skip.map((l) => l.id), ['install-browser', 'plan', 'auto']);
});

test('e2e pack preserves dependency layers for targeted runs', () => {
  const smoke = runner.selectedLayers(runner.parseArgs(['live', '--only=smoke']));
  assert.deepStrictEqual(smoke.map((l) => l.id), ['install-browser', 'smoke']);

  const observability = runner.selectedLayers(runner.parseArgs(['cert', '--only=pipeline-build']));
  assert.deepStrictEqual(observability.map((l) => l.id), ['telemetry', 'pipeline-build']);
});

test('all live/cert node test layers force exit and have watchdog caps', () => {
  const layers = [...runner.LIVE_LAYERS, ...runner.CERT_LAYERS];
  for (const layer of layers) {
    assert.ok(layer.timeoutSec > 0, `${layer.id} needs a watchdog timeout`);
    assert.deepStrictEqual(layer.command.slice(0, 2), ['node', '--test'], `${layer.id} must use node --test`);
    assert.ok(layer.command.includes('--test-force-exit'), `${layer.id} must force node:test exit`);
  }
});

test('fast profile includes e2e contracts and helper tests without live Claude', () => {
  assert.ok(runner.FAST_FILES.includes('test/automated-e2e-contract.test.js'));
  assert.ok(runner.FAST_FILES.includes('test/e2e-no-hang-contract.test.js'));
  assert.ok(runner.FAST_FILES.some((file) => file.endsWith('claude-runner.test.js')));
  assert.ok(!runner.FAST_FILES.some((file) => file.endsWith('app-runtime.test.js')));
  assert.ok(runner.FAST_FILES.every((file) => !file.startsWith('test/e2e/harness-')));
});

test('legacy run.sh delegates to the Node e2e pack runner', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'test', 'e2e', 'run.sh'), 'utf8');
  assert.match(sh, /run-pack\.js/);
  assert.match(sh, /\bcert\b/);
});
