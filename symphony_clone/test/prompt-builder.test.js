'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHarnessPrompt, groupFromIssue } = require('../src/orchestrator/prompt-builder');
const { shellQuote } = require('../src/orchestrator/claude-runner');

test('groupFromIssue extracts harness group metadata from issue description', () => {
  const group = groupFromIssue({
    key: 'ENG-101',
    description: `
## Harness Group
- Group: A
- Stories: E1-S1, E1-S2
`
  });

  assert.deepEqual(group, {
    id: 'A',
    tracker_key: 'ENG-101',
    stories: ['E1-S1', 'E1-S2']
  });
});

test('groupFromIssue extracts Linear markdown bullet metadata', () => {
  const group = groupFromIssue({
    key: 'RES-19',
    description: `
## Harness Group

* Group: A
* Harness command: /auto --group A
* Stories: E1-S1
`
  });

  assert.deepEqual(group, {
    id: 'A',
    tracker_key: 'RES-19',
    stories: ['E1-S1']
  });
});

test('buildHarnessPrompt includes group command and result path', () => {
  const prompt = buildHarnessPrompt(
    { key: 'ENG-101', url: 'https://linear.app/example/ENG-101' },
    { id: 'A', stories: ['E1-S1'] }
  );

  assert.match(prompt, /\/auto --group A/);
  assert.match(prompt, /\.claude\/state\/tracker-runs\/A\/result\.json/);
});

test('shellQuote protects prompts with spaces and apostrophes', () => {
  assert.equal(shellQuote("don't edit files"), "'don'\\''t edit files'");
});
