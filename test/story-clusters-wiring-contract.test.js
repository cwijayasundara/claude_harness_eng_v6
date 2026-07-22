'use strict';

// Locks the G37 ownership-cluster wiring. The harness's recurring failure is a
// control that is built, tested, and never actually invoked — every assertion
// here is about the seam, not the algorithm.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('story-clusters CLI reuses the tested lib rather than reimplementing the graph algebra', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/story-clusters.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/story-graph.js')));
  assert.match(
    read('.claude/scripts/story-clusters.js'),
    /require\('\.\.\/hooks\/lib\/story-graph'\)/,
    'CLI must use the tested lib',
  );
});

test('package.json exposes the script and /spec Step 4.5 runs it', () => {
  assert.strictEqual(
    JSON.parse(read('package.json')).scripts['story-clusters'],
    'node .claude/scripts/story-clusters.js',
  );
  const spec = readSkillCorpus('spec');
  assert.match(spec, /story-clusters\.js/, '/spec must run the clusterer');
  assert.match(spec, /Step 4\.5 — Ownership Clusters \[HARD BLOCK\]/, 'the step must be a hard block');
});

test('/spec writes the machine-readable inputs the clusterer consumes', () => {
  const spec = readSkillCorpus('spec');
  assert.match(spec, /specs\/stories\/stories\.json/, 'Step 3.9 must emit the story index');
  assert.match(spec, /specs\/stories\/story-clusters\.json/, 'the cluster artifact must be declared');
  assert.match(spec, /specs\/stories\/dependency-edges\.json/, 'the edge artifact must be declared');
});

test('/spec documents all four edge kinds and which are cuttable', () => {
  const spec = readSkillCorpus('spec');
  for (const kind of ['contract', 'data', 'behavior', 'ui']) {
    assert.match(spec, new RegExp(`\`${kind}\``), `edge kind ${kind} must be documented`);
  }
  assert.match(spec, /Groups are not owners/, 'the wave-vs-cluster distinction must be stated');
});

test('/spec keeps the wave graph intact alongside the cluster view', () => {
  const spec = readSkillCorpus('spec');
  assert.match(spec, /specs\/stories\/dependency-graph\.json/, 'wave graph must still be emitted');
  assert.match(spec, /wave-plan\.js/, 'wave planner must still be referenced');
});

test('INVEST independent is backfilled from the cluster plan, not self-asserted', () => {
  const spec = readSkillCorpus('spec');
  assert.match(spec, /Backfill `invest\.independent`/, 'independent must be computed');
  assert.match(spec, /independently_startable/, 'it must derive from the cluster field');
});

test('manifest registers the sensor as an active traceability control with a budget justification', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'story-ownership-clusters');
  assert.ok(s, 'expected a story-ownership-clusters sensor entry');
  assert.strictEqual(s.axis, 'traceability');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.wired_at, '.claude/scripts/story-clusters.js');
  assert.ok(s.net_add_justification, 'a net-add control must justify its budget cost');
});

test('HARNESS.md registers the control so it is not orphaned from the registry', () => {
  assert.match(read('HARNESS.md'), /story-ownership-clusters/);
});

test('scaffold-copy propagates the script to scaffolded projects', () => {
  assert.match(read('.claude/scripts/scaffold-copy.js'), /'story-clusters\.js'/);
});
