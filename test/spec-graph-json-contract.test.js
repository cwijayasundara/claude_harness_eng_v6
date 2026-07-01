'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const SPEC_SKILL = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'spec', 'SKILL.md'), 'utf8',
);

test('/spec documents the machine-readable dependency-graph.json', () => {
  assert.ok(SPEC_SKILL.includes('dependency-graph.json'), 'SKILL.md must instruct writing dependency-graph.json');
  assert.ok(/blockedBy/.test(SPEC_SKILL), 'SKILL.md must document the blockedBy field');
});

test('/spec requires deterministic story point estimation metadata', () => {
  const storyTemplate = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'templates', 'story.template.md'), 'utf8',
  );
  const phaseRubrics = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'templates', 'phase-eval-rubrics.json'), 'utf8',
  ));

  assert.match(SPEC_SKILL, /Story Points/i, 'SKILL.md must require a Story Points field');
  assert.match(SPEC_SKILL, /Estimation Confidence/i, 'SKILL.md must require an Estimation Confidence field');
  assert.match(SPEC_SKILL, /Estimation Drivers/i, 'SKILL.md must require Estimation Drivers');
  assert.match(SPEC_SKILL, /1,\s*2,\s*3,\s*5,\s*8,\s*13/, 'SKILL.md must document the allowed point scale');
  assert.match(SPEC_SKILL, /above `?13`?.*needs_breakdown/i, 'stories above 13 points must be blocked for breakdown');

  assert.match(storyTemplate, /Story Points:/, 'story template must include Story Points');
  assert.match(storyTemplate, /Estimation Confidence:/, 'story template must include Estimation Confidence');
  assert.match(storyTemplate, /Estimation Drivers:/, 'story template must include Estimation Drivers');

  assert.match(
    phaseRubrics.phases.spec.criteria.actionability,
    /story points/i,
    'spec evaluation rubric must check story points',
  );
});

test('the dependency-graph.json fixture matches the wave-plan schema', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'e2e', 'fixtures', 'stories', 'dependency-graph.json'), 'utf8',
  ));
  assert.ok(Array.isArray(graph.groups));
  for (const grp of graph.groups) {
    assert.strictEqual(typeof grp.id, 'string');
    assert.ok(Array.isArray(grp.stories));
    assert.ok(Array.isArray(grp.blockedBy));
  }
});

test('the json fixture covers the same groups as the md fixture', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'e2e', 'fixtures', 'stories', 'dependency-graph.json'), 'utf8',
  ));
  assert.deepStrictEqual(graph.groups.map((g) => g.id).sort(), ['A', 'B']);
});
