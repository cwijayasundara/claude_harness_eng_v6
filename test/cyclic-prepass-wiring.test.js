'use strict';

// Gap G33 (cyclic-dependency pre-pass). Prompt-level guide only — no
// computational sensor — so this locks the instruction text into the one
// skill it governs, the same pattern test/canary-rollout-wiring.test.js
// uses for G32's canary-first guide (a skill-prompt-only feature with no
// runtime script to unit-test directly).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('fix-from-diagnostics runs a cyclic-dependency pre-pass before sharding by package', () => {
  const skill = read('.claude/skills/fix-from-diagnostics/SKILL.md');
  assert.match(skill, /[Cc]yclic-dependency pre-pass/, 'must describe a cyclic-dependency pre-pass step');
  assert.match(skill, /before sharding/i, 'must state the pre-pass runs before sharding by package');
  assert.match(skill, /≥ ?3 packages/, 'must state a concrete affected-package-count trigger threshold');
  assert.match(skill, /error-dense/, 'must describe identifying error-dense packages');
  assert.match(skill, /modularity-pack\.md/, 'must reference the modularity pack as the primary cycle source');
  assert.match(skill, /code-graph\.json/, 'must reference code-graph.json cycles as a fallback cycle source');
  assert.match(skill, /structural pass/, 'must describe a structural pass to break the cycle first');
  assert.match(skill, /re-capture diagnostics/i, 'must state diagnostics are re-captured after the structural pass');
});
