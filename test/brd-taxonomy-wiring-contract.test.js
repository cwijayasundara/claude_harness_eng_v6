'use strict';

// Locks the G38 BRD-comprehensiveness wiring. Assertions are about the seam —
// that the gate is actually invoked and the rubric defers to its verdict — not
// about the slot logic, which brd-taxonomy-check.test.js covers.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { SLOTS } = require(path.join(ROOT, '.claude/scripts/brd-taxonomy-check.js'));

test('package.json exposes the gate and /brd Step 4.45 runs it as a hard block', () => {
  assert.strictEqual(
    JSON.parse(read('package.json')).scripts['brd-taxonomy'],
    'node .claude/scripts/brd-taxonomy-check.js',
  );
  const brd = readSkillCorpus('brd');
  assert.match(brd, /brd-taxonomy-check\.js/, '/brd must run the taxonomy gate');
  assert.match(brd, /Step 4\.45 — Requirement-Taxonomy Floor \[HARD BLOCK/, 'must be a hard block');
});

test('/brd documents every slot the gate enforces — no drift between prose and code', () => {
  const brd = readSkillCorpus('brd');
  for (const slot of SLOTS) {
    assert.match(brd, new RegExp(`\`${slot}\``), `slot ${slot} must be documented in /brd`);
  }
});

test('/brd declares the artifacts the gate and the downstream AC round-trip consume', () => {
  const brd = readSkillCorpus('brd');
  assert.match(brd, /specs\/brd\/taxonomy-coverage\.json/);
  assert.match(brd, /specs\/brd\/brd-acceptance\.json/);
  assert.match(brd, /specs\/brd\/brd-safeguards\.json/);
  assert.match(brd, /"taxonomy":/, 'BR entries must carry a taxonomy tag');
});

test('/spec closes the acceptance round-trip against the BRD acceptance ids', () => {
  const spec = readSkillCorpus('spec');
  assert.match(spec, /Step 6\.46 — Acceptance-Criterion Grounding \[HARD BLOCK/);
  assert.match(spec, /specs\/brd\/brd-acceptance\.json/, 'must use the BRD acceptance spine as required');
  assert.match(spec, /specs\/stories\/acceptance-criteria\.json/, 'must emit the criterion spine');
  assert.match(spec, /trace-check\.js/, 'must reuse the existing trace engine, not a new one');
});

test('rubrics defer to the deterministic verdicts instead of re-judging from prose', () => {
  const rubrics = JSON.parse(read('.claude/templates/phase-eval-rubrics.json'));
  assert.match(rubrics.phases.brd.hard_gate, /brd-taxonomy\.json/);
  assert.match(rubrics.phases.brd.criteria.completeness, /brd-taxonomy\.json/);
  assert.match(rubrics.phases.spec.hard_gate, /story-clusters\.js/);
  assert.match(rubrics.phases.spec.hard_gate, /spec-acceptance-grounding\.json/);
  assert.match(rubrics.phases.spec.criteria.actionability, /independently_startable/);
});

test('manifest and HARNESS.md register the control with a budget justification', () => {
  const s = JSON.parse(read('harness-manifest.json')).sensors.find((x) => x.id === 'brd-taxonomy-floor');
  assert.ok(s, 'expected a brd-taxonomy-floor sensor entry');
  assert.strictEqual(s.axis, 'traceability');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.wired_at, '.claude/scripts/brd-taxonomy-check.js');
  assert.ok(s.net_add_justification);
  assert.match(read('HARNESS.md'), /brd-taxonomy-floor/);
});

test('scaffold-copy propagates the gate to scaffolded projects', () => {
  assert.match(read('.claude/scripts/scaffold-copy.js'), /'brd-taxonomy-check\.js'/);
});

// --- D9: BRD safeguards must reach the design contract ------------------------

test('validate-canvas checks safeguard coverage, reusing the tested lib', () => {
  const cli = read('.claude/scripts/validate-canvas.js');
  assert.match(cli, /checkSafeguardCoverage/, 'CLI must run the coverage check');
  assert.match(cli, /brd-safeguards\.json/, 'CLI must default to the BRD safeguard spine');
  assert.match(
    read('.claude/hooks/lib/canvas.js'),
    /function checkSafeguardCoverage/,
    'the logic must live in the tested lib, not the CLI',
  );
});

test('/design blocks on uncovered safeguards and states the skip/empty-spine rule', () => {
  const design = readSkillCorpus('design');
  assert.match(design, /brd-safeguards\.json/, '/design must reference the safeguard spine');
  assert.match(design, /empty_spine/, 'an empty spine must not be usable to silence the gate');
});

test('the Canvas template tells the author to cite SG-n ids in both sections', () => {
  const tpl = read('.claude/skills/design/references/reasons-canvas-template.md');
  assert.match(tpl, /`SG-n`/, 'template must require SG-n citations');
  assert.match(tpl, /## Safeguards/);
  assert.match(tpl, /## Norms/);
});

test('the canvas-structure control records the coverage extension', () => {
  const s = JSON.parse(read('harness-manifest.json')).sensors.find((x) => x.id === 'canvas-structure');
  assert.ok(s, 'expected the canvas-structure sensor');
  assert.match(s.description, /brd-safeguards\.json/, 'registry must describe the D9 extension');
  assert.match(s.signal, /SG-n/, 'the signal must mention the new failure mode');
});
