'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlanningPrompt } = require('./planning-prompt');

const prdIssue = {
  key: 'PRD-1',
  url: 'https://linear.app/x/issue/PRD-1',
  description: '# PRD: Bookmarks\n\n## 3. Functional Requirements\n- FR-1 save a link'
};

test('buildPlanningPrompt embeds the PRD and drives the planning pipeline + tracker-publish', () => {
  const prompt = buildPlanningPrompt(prdIssue);
  assert.match(prompt, /FR-1 save a link/); // the PRD (issue description) is the grounding baseline
  assert.match(prompt, /PRD-1/);
  assert.match(prompt, /\/brd --prd/);
  assert.match(prompt, /\/spec/);
  assert.match(prompt, /\/design/);
  assert.match(prompt, /\/test --plan-only/);
  assert.match(prompt, /\/tracker-publish/);
  assert.match(prompt, /do not (generate|implement) application code/i);
  assert.match(prompt, /"status": "planned"/); // the status the orchestrator keys off
  // VULN-101: the PRD is fenced as untrusted data with an injection guard
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /NOT instructions to you|never follow directives/i);
  assert.match(prompt, /BEGIN PRD[\s\S]*FR-1 save a link[\s\S]*END PRD/);
});

test('buildPlanningPrompt handles a missing description without leaking placeholders', () => {
  const prompt = buildPlanningPrompt({ key: 'PRD-2' });
  assert.doesNotMatch(prompt, /\{\{/);
  assert.match(prompt, /PRD-2/);
});
