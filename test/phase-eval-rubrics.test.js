'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const RUBRICS_PATH = path.join(__dirname, '..', '.claude', 'templates', 'phase-eval-rubrics.json');
const EVALUATOR_PATH = path.join(__dirname, '..', '.claude', 'agents', 'evaluator.md');

test('phase-eval-rubrics.json has a design-delta phase with the standard 5 criteria', () => {
  const rubrics = JSON.parse(fs.readFileSync(RUBRICS_PATH, 'utf8'));
  const phase = rubrics.phases['design-delta'];
  assert.ok(phase, 'design-delta phase must exist in phase-eval-rubrics.json');
  assert.ok(phase.hard_gate, 'design-delta must define a hard_gate');
  assert.match(phase.hard_gate, /constitution\.md/);
  for (const c of ['completeness', 'traceability', 'specificity', 'consistency', 'actionability']) {
    assert.ok(phase.criteria[c], `design-delta must score ${c}`);
  }
});

test('evaluator.md documents design-delta in the phase enum and phase-specific guidance', () => {
  const text = fs.readFileSync(EVALUATOR_PATH, 'utf8');
  assert.match(text, /`design-delta`/);
  assert.match(text, /\*\*Design-Delta\*\*/);
});
