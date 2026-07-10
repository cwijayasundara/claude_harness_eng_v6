'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const AUTO = readSkillCorpus('auto');

test('pod mode wires the deterministic planner and PR opener', () => {
  assert.ok(AUTO.includes('wave-plan.js'), 'must call wave-plan.js');
  assert.ok(AUTO.includes('wave-pr.js'), 'must call wave-pr.js');
});

test('pod mode no longer waits for predecessor PRs to merge', () => {
  assert.ok(!/wait for .*PRs to merge/i.test(AUTO), 'merge-wait language must be gone');
});

test('pod mode documents stacked bases (no merge wait)', () => {
  assert.ok(/stack/i.test(AUTO), 'must describe stacked branches/PRs');
});
