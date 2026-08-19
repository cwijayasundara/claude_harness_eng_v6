'use strict';

// SSDD (Structured Story-Driven Development) — the four human planning gates
// plus /scaffold share one doctrine; /auto is generate from the implementable
// bundle. Scripts write volume; fix the structured record first.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus, skillEntryLineCount } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('SSDD doctrine exists and maps the five human-managed gates plus generate', () => {
  const ssdd = read('.claude/skills/plan-review-loop/references/ssdd.md');
  assert.match(ssdd, /Structured Story-Driven Development/);
  assert.match(ssdd, /martinfowler.com\/articles\/structured-prompt-driven/);
  assert.match(ssdd, /fix the structured story record first/i);
  for (const gate of ['/scaffold', '/brd', '/spec', '/design', '/test', '/auto']) {
    assert.match(ssdd, new RegExp(gate.replace('/', '\\/')), `SSDD map missing ${gate}`);
  }
  assert.match(ssdd, /specs\/bundles\//);
  assert.match(ssdd, /Generation Contract/);
  assert.match(ssdd, /\/spdd-generate/);
  assert.match(ssdd, /Teammates get the bundle/);
});

test('each human gate cites SSDD and stays an orchestrator index', () => {
  const budgets = { brd: 80, spec: 80, design: 80, test: 80 };
  for (const [phase, budget] of Object.entries(budgets)) {
    const corpus = readSkillCorpus(phase);
    assert.match(corpus, /ssdd\.md/, `/${phase} must cite ssdd.md`);
    assert.ok(
      skillEntryLineCount(phase) <= budget,
      `/${phase} entry is ${skillEntryLineCount(phase)} lines (budget ${budget})`,
    );
  }
  assert.match(read('.claude/commands/scaffold.md'), /SSDD/);
  assert.match(read('.claude/commands/scaffold.md'), /scaffold-wizard\.md/);
});

test('/auto is SSDD generate: bundles, join sensors, no story-dump spawn', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /ssdd\.md/);
  assert.match(auto, /\/spdd-generate/);
  assert.match(auto, /generation-contract/);
  assert.match(auto, /bundle-check\.js/);
  assert.match(auto, /canvas-sync-check/);
  assert.match(auto, /spdd-sync\.js/);
  assert.doesNotMatch(
    auto,
    /Read specs\/stories\/ for every story/,
    '/auto spawn must not dump every story file',
  );
  assert.match(auto, /regression-gate\.js --replay/);
  assert.match(
    auto,
    /G15 if this is not the first landed group/,
    'sequential /auto must run G15 when committing to WAVE_BASE',
  );
});

test('plan-review-loop requires fix-the-record-first on change requests', () => {
  const loop = read('.claude/skills/plan-review-loop/SKILL.md');
  assert.match(loop, /Fix the structured record first/);
  assert.match(loop, /spec-decisions\.json/);
  assert.match(loop, /reasons-canvas\.md/);
});

test('design-render does not dump every story file into context', () => {
  const render = read('.claude/skills/design-render/SKILL.md');
  assert.doesNotMatch(render, /Read all ready story files/);
  assert.match(render, /stories\.json/);
});

test('spec-render-write joins skeleton bundles after the story graph', () => {
  assert.match(
    read('.claude/scripts/spec-render-write.js'),
    /require\('\.\/bundle-write'\)/,
  );
});
