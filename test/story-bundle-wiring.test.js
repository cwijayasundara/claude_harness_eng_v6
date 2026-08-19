'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shipsIn } = require('./helpers/pack-membership');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('CLIs use the tested lib', () => {
  assert.match(read('.claude/scripts/bundle-write.js'), /hooks\/lib\/story-bundle/);
  assert.match(read('.claude/scripts/bundle-check.js'), /hooks\/lib\/story-bundle/);
});

test('package.json exposes both scripts', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.strictEqual(scripts['bundle-write'], 'node .claude/scripts/bundle-write.js');
  assert.strictEqual(scripts['bundle-check'], 'node .claude/scripts/bundle-check.js');
});

test('manifest registers the guide and sensor with budget justifications', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const guide = m.guides.find((x) => x.id === 'story-bundle');
  const sensor = m.sensors.find((x) => x.id === 'story-bundle-check');
  assert.ok(guide && guide.net_add_justification);
  assert.ok(sensor && sensor.net_add_justification);
  assert.strictEqual(sensor.wired_at, '.claude/scripts/bundle-check.js');
  assert.strictEqual(guide.wired_at, '.claude/hooks/lib/story-bundle.js');
});

test('HARNESS.md names the new controls', () => {
  const md = read('HARNESS.md');
  assert.match(md, /story bundle/i);
  assert.match(md, /story-bundle-check/);
});

test('bundle scripts ship in the planning pack; lib in the kernel', () => {
  assert.ok(shipsIn('bundle-write', 'script').includes('core'));
  assert.ok(shipsIn('bundle-check', 'script').includes('core'));
  assert.ok(shipsIn('story-bundle', 'lib').includes('kernel') || shipsIn('story-bundle', 'lib').includes('core'));
});

test('implement and auto hard-block on implementable bundles', () => {
  const implement = readSkillCorpus('implement');
  assert.match(implement, /bundle-check\.js --mode implementable/);
  const auto = readSkillCorpus('auto');
  assert.match(auto, /bundle-check\.js --mode implementable/);
  assert.match(auto, /specs\/bundles\//);
});

test('/test requires original-requirement traces when brd-acceptance exists', () => {
  const testSkill = readSkillCorpus('test');
  assert.match(testSkill, /brd-acceptance\.json/);
  assert.match(testSkill, /BR-n-AC|brd-acceptance id/);
});

test('/build writes bundles before the plan seal', () => {
  const build = readSkillCorpus('build');
  const writeAt = build.indexOf('bundle-write.js');
  const sealAt = build.indexOf('plan-seal.js write');
  assert.ok(writeAt !== -1, 'build must run bundle-write');
  assert.ok(sealAt !== -1, 'build must still write the plan seal');
  assert.ok(writeAt < sealAt, 'bundles must be written before the seal');
});
