'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { classify, runCanaries, provenLiveSensors } = require('../.claude/scripts/sensor-canary');
const { CANARIES } = require('../.claude/config/sensor-canaries');

// The classifier is the load-bearing logic: LIVE requires BOTH discrimination halves.
test('classify: only bit-and-quiet is LIVE', () => {
  assert.strictEqual(classify({ bit: true, quiet: true }), 'LIVE');
  assert.strictEqual(classify({ bit: false, quiet: true }), 'DEAD', 'missing the known-bad input is dead');
  assert.strictEqual(classify({ bit: true, quiet: false }), 'FALSE-POSITIVE', 'firing on good input is broken');
  assert.strictEqual(classify(null), 'DEAD', 'a probe that threw is dead');
});

// Every registered canary must prove its gate live against the gate's REAL detector.
// If this goes red, a preventive gate has stopped catching its own known-bad input.
test('every registered canary is LIVE', () => {
  for (const r of runCanaries(CANARIES)) {
    assert.strictEqual(r.status, 'LIVE', `${r.probe} canary is ${r.status} — the gate no longer discriminates`);
  }
});

test('a deliberately dead canary is caught (the mechanism can fail)', () => {
  const dead = [{ probe: 'x', sensors: ['x'], why: 'stub', run: () => ({ bit: false, quiet: true }) }];
  assert.strictEqual(runCanaries(dead)[0].status, 'DEAD');
  assert.deepStrictEqual([...provenLiveSensors(dead)], [], 'a dead canary proves nothing live');
});

test('provenLiveSensors expands to every ledger name a live probe backs', () => {
  const live = provenLiveSensors(CANARIES);
  assert.ok(live.has('secret-scan') && live.has('secret-scan-write'),
    'the secret probe proves both the commit and session wirings');
});

test('the CLI exits 0 when all canaries are live', () => {
  const r = spawnSync('node', [path.join(ROOT, '.claude', 'scripts', 'sensor-canary.js')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `sensor-canary CLI must pass:\n${r.stdout}\n${r.stderr}`);
});
