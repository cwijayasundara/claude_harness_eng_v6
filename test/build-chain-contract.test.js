// test/build-chain-contract.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AUTO = '.claude/skills/auto/SKILL.md';
const BUILD = '.claude/skills/build/SKILL.md';
const LANE = '.claude/skills/build/references/autonomous-lane.md';
const PKG = 'package.json';
const README = 'README.md';

test('/auto documents --once single-wave mode', () => {
  const a = read(AUTO);
  assert.match(a, /--once\b/);
  assert.match(a, /single-wave|exactly one wave|one wave/i);
});

test('/auto --once exits cleanly and writes the handoff next_action', () => {
  const a = read(AUTO);
  // it must tell the next process what to do: DONE when finished, CONTINUE otherwise
  assert.match(a, /next_action:\s*DONE/);
  assert.match(a, /next_action:\s*CONTINUE|CONTINUE —/);
});

test('/build documents --finalize as the build-chain terminal link', () => {
  const b = read(BUILD);
  assert.match(b, /--finalize\b/);
  assert.match(b, /Phases 9.*9\.5.*10.*11|terminal link/i);
});

test('package exposes build:chain as the unattended PRD-to-PR launcher', () => {
  const pkg = JSON.parse(read(PKG));
  assert.strictEqual(pkg.scripts['build:chain'], 'node .claude/scripts/build-chain.js');
});

test('README points unattended users at the resilient build-chain launcher', () => {
  const readme = read(README);
  assert.match(readme, /node \.claude\/scripts\/build-chain\.js docs\/prd\.md/);
  assert.match(readme, /fresh `claude -p` process per build wave|fresh process per build wave/i);
});
