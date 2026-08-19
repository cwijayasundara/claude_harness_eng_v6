'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shipsIn } = require('./helpers/pack-membership');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('generation-contract CLI uses the tested lib', () => {
  assert.match(
    read('.claude/scripts/validate-generation-contract.js'),
    /require\('\.\.\/hooks\/lib\/generation-contract'\)/,
  );
  assert.match(
    read('.claude/scripts/analysis-seed.js'),
    /require\('\.\.\/hooks\/lib\/analysis-seed'\)/,
  );
});

test('package.json exposes both scripts', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.strictEqual(scripts['generation-contract'], 'node .claude/scripts/validate-generation-contract.js');
  assert.strictEqual(scripts['analysis-seed'], 'node .claude/scripts/analysis-seed.js');
});

test('manifest registers the guide and the sensor with budget justifications', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const guide = m.guides.find((x) => x.id === 'story-generation-contract');
  const seed = m.guides.find((x) => x.id === 'lean-analysis-seed');
  const sensor = m.sensors.find((x) => x.id === 'generation-contract');
  assert.ok(guide && guide.net_add_justification);
  assert.ok(seed && seed.net_add_justification);
  assert.ok(sensor && sensor.net_add_justification);
  assert.strictEqual(sensor.wired_at, '.claude/hooks/lib/gates-ssdd.js');
});

test('HARNESS.md names the new controls', () => {
  const md = read('HARNESS.md');
  assert.match(md, /generation-contract/);
  assert.match(md, /lean analysis seed/);
});

test('validate-generation-contract ships in the kernel profile; analysis-seed in core', () => {
  assert.ok(shipsIn('validate-generation-contract', 'script').includes('kernel'));
  assert.ok(shipsIn('analysis-seed', 'script').includes('core'));
});

test('spec-render emits the contract; implement and change gate implementable mode', () => {
  const spec = readSkillCorpus('spec-render');
  assert.match(spec, /--mode skeleton/);
  const implement = read('.claude/skills/implement/SKILL.md');
  assert.match(implement, /HARD BLOCK/);
  const change = read('.claude/skills/change/SKILL.md');
  assert.match(change, /--mode implementable/);
});
