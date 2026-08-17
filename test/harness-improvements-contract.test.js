'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('BRD skill keeps SPDD analysis on --full only', () => {
  const skill = read('.claude/skills/brd/SKILL.md');
  assert.match(skill, /brd-analysis\.json/);
  assert.match(skill, /`--full` only|lean `--prd`/);
  const full = read('.claude/skills/brd-render/SKILL.md');
  for (const phrase of [
    'Domain Concepts',
    'Ambiguity Table',
    'Edge-Case Table',
    'AC Coverage Matrix',
    'Risk & Gap Table',
  ]) {
    assert.match(full, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing ${phrase}`);
  }
});

test('phase evaluator rubric scores BRD analysis depth', () => {
  const rubrics = JSON.parse(read('.claude/templates/phase-eval-rubrics.json'));
  const brdText = JSON.stringify(rubrics.phases.brd);
  for (const phrase of ['ambiguity', 'edge-case', 'acceptance criteria coverage', 'domain concepts']) {
    assert.match(brdText, new RegExp(phrase, 'i'), `BRD rubric should mention ${phrase}`);
  }
});

test('sensor arbitration policy and waiver schema are documented and registered', () => {
  const doc = read('docs/sensor-arbitration.md');
  for (const phrase of ['Blocking Levels', 'Conflict Order', 'Waiver Schema', 'Expiry']) {
    assert.match(doc, new RegExp(phrase), `sensor arbitration doc missing ${phrase}`);
  }

  const schema = JSON.parse(read('.claude/templates/sensor-waivers.schema.json'));
  assert.deepStrictEqual(schema.required, ['waivers']);
  assert.ok(schema.properties.waivers.items.required.includes('sensor_id'));
  assert.ok(schema.properties.waivers.items.required.includes('expires'));

  const harness = read('HARNESS.md');
  assert.match(harness, /blocking level/i);
  assert.match(harness, /waiver/i);
});

test('scaffold ships an optional drift cadence workflow template', () => {
  const workflow = read('.claude/templates/github-workflows/harness-drift.yml');
  for (const command of ['npm run drift', 'npm run harness-coverage', 'npm run flakes', 'npm run approved-fixtures', 'npm run contract-drift']) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `workflow missing ${command}`);
  }
  assert.match(workflow, /HARNESS_SLO_URL/);

  const scaffold = read('.claude/scripts/scaffold-apply.js');
  assert.match(scaffold, /harness-drift\.yml/);
});

test('Canvas sync checker compares changed files with the living Canvas', () => {
  const sync = require(path.join(ROOT, '.claude/hooks/lib/canvas-sync.js'));
  const canvas = [
    '## Requirements',
    'x',
    '## Entities',
    'x',
    '## Approach',
    'x',
    '## Structure',
    'x',
    '## Operations',
    '- Update `src/billing/service.py` to calculate charges.',
    '## Norms',
    'Use Decimal for money.',
    '## Safeguards',
    'Never use floats for currency.',
    '## Governs',
    '- src/billing/service.py',
    '',
  ].join('\n');

  const clean = sync.checkCanvasSync({
    canvasText: canvas,
    changedFiles: ['src/billing/service.py'],
  });
  assert.deepStrictEqual(clean.missingFromGoverns, []);
  assert.deepStrictEqual(clean.missingFromOperations, []);

  const drift = sync.checkCanvasSync({
    canvasText: canvas,
    changedFiles: ['src/billing/rates.py'],
  });
  assert.deepStrictEqual(drift.missingFromGoverns, ['src/billing/rates.py']);
  assert.deepStrictEqual(drift.missingFromOperations, ['src/billing/rates.py']);
});

test('design guidance performs greenfield modularity assessment before code', () => {
  const design = readSkillCorpus('design');
  for (const phrase of [
    'core/supporting/generic',
    'volatility',
    'integration contracts',
    'coupling risks',
    'Balanced Coupling',
  ]) {
    assert.match(design, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `design skill missing ${phrase}`);
  }
});

test('spec and design consume the BRD analysis pack downstream', () => {
  const spec = readSkillCorpus('spec');
  const design = readSkillCorpus('design');
  for (const doc of [spec, design]) {
    assert.match(doc, /brd-analysis\.json/);
    assert.match(doc, /ambiguity_table/);
    assert.match(doc, /edge_case_table/);
    assert.match(doc, /risk_gap_table/);
  }
});

test('per-step token/cost persist is wired through record-run and /status', () => {
  assert.match(read('.claude/hooks/record-run.js'), /persistPhaseCost/);
  assert.match(read('.claude/hooks/lib/phase-cost-persist.js'), /phase-cost\.jsonl/);
  assert.match(read('.claude/scripts/phase-cost.js'), /--write/);
  assert.match(read('.claude/scripts/pipeline-state-readers.js'), /source: 'transcript'/);
  assert.match(read('.claude/skills/brd/references/prd-lean.md'), /phase-cost\.js --write/);
});

test('lean --prd analysis seed and story generation contract are wired', () => {
  const extract = read('.claude/scripts/prd-extract.js');
  assert.match(extract, /analysis-seed\.js/);
  const specRender = readSkillCorpus('spec-render');
  assert.match(specRender, /analysis-seed\.json/);
  assert.match(specRender, /Generation Contract/);
  assert.match(specRender, /validate-generation-contract\.js/);
  const implement = read('.claude/skills/implement/SKILL.md');
  assert.match(implement, /--mode implementable/);
  const change = read('.claude/skills/change/SKILL.md');
  assert.match(change, /validate-generation-contract\.js/);
});
