'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHarnessPrompt, buildFeaturePrompt, groupFromIssue, resolveHarnessCommand } = require('../src/orchestrator/prompt-builder');
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

test('resolveHarnessCommand defaults to /auto when no env or label override', () => {
  delete process.env.HARNESS_COMMAND_TEMPLATE;
  const cmd = resolveHarnessCommand({ key: 'RES-21', labels: [] }, { id: 'A' });
  assert.equal(cmd, '/auto --group A');
});

test('resolveHarnessCommand honors HARNESS_COMMAND_TEMPLATE env override', () => {
  process.env.HARNESS_COMMAND_TEMPLATE = '/lite --group {{group}} --issue {{issue}}';
  try {
    const cmd = resolveHarnessCommand({ key: 'RES-21', labels: [] }, { id: 'A' });
    assert.equal(cmd, '/lite --group A --issue RES-21');
  } finally {
    delete process.env.HARNESS_COMMAND_TEMPLATE;
  }
});

test('resolveHarnessCommand prefers issue label mode-* over env', () => {
  process.env.HARNESS_COMMAND_TEMPLATE = '/auto --group {{group}}';
  try {
    const cmd = resolveHarnessCommand(
      { key: 'RES-21', labels: ['harness-e2e', 'mode-lite'] },
      { id: 'A' }
    );
    assert.equal(cmd, '/lite --group A');
  } finally {
    delete process.env.HARNESS_COMMAND_TEMPLATE;
  }
});

test('buildFeaturePrompt runs /feature --auto with the issue title as the request', () => {
  const prompt = buildFeaturePrompt({
    key: 'BUG-12',
    title: 'fix null deref in the CSV parser',
    description: 'Repro: upload an empty file. Expected: 400, got a crash.',
    url: 'https://tracker/BUG-12',
  });
  assert.match(prompt, /\/feature "fix null deref in the CSV parser" --auto/);
  assert.match(prompt, /UNTRUSTED INPUT DATA/);
  assert.match(prompt, /Repro: upload an empty file/);
  assert.match(prompt, /tracker-runs\/BUG-12\/result\.json/);
  assert.match(prompt, /do NOT (push|open)/i);
  assert.match(prompt, /"status": "blocked"/);
  assert.match(prompt, /adherence-report\.md/);
});

test('buildFeaturePrompt sanitizes double quotes in the title', () => {
  const prompt = buildFeaturePrompt({ key: 'X-1', title: 'add "fast" mode', description: '' });
  assert.doesNotMatch(prompt, /\/feature "add "fast" mode"/); // unescaped nested quotes would break the arg
  assert.match(prompt, /\/feature "add 'fast' mode" --auto/);
});
