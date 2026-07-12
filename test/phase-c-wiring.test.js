'use strict';

// Bun Phase C wiring: semantic divergence, review commit msgs, workflow exemplar.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { formatReviewSubject } = require('../.claude/scripts/review-commit-msg');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('semantic-divergence checklist exists with Bun-class hazards', () => {
  const doc = read('.claude/skills/code-gen/references/semantic-divergence.md');
  assert.match(doc, /debug_assert|Assert \/ debug/i);
  assert.match(doc, /Drop|defer/i);
  assert.match(doc, /odd-length|Slice/i);
});

test('code-reviewer has semantic-divergence lens for mechanical ports', () => {
  const agent = read('.claude/agents/code-reviewer.md');
  assert.match(agent, /Semantic-divergence lens/);
  assert.match(agent, /semantic-divergence\.md/);
});

test('/refactor --mechanical requires semantic divergence review', () => {
  const skill = read('.claude/skills/refactor/SKILL.md');
  assert.match(skill, /Semantic divergence/);
  assert.match(skill, /semantic-divergence\.md/);
  assert.match(skill, /review-commit-msg\.js/);
});

test('formatReviewSubject attributes review metadata', () => {
  const s = formatReviewSubject({
    subject: 'fix uaf on pipe close',
    reviewId: 'adversarial',
    policy: 'union',
    blockCount: 2,
    finding: 'leak Box before async close',
  });
  assert.match(s, /fix uaf on pipe close/);
  assert.match(s, /review:adversarial/);
  assert.match(s, /policy=union/);
  assert.match(s, /blocks=2/);
});

test('review-commit-msg is on CORE_SCRIPTS', () => {
  const copy = read('.claude/scripts/scaffold-copy.js');
  assert.match(copy, /'review-commit-msg\.js'/);
  assert.match(copy, /workflows/, 'core scaffold must copy workflows for fix-diagnostics');
});

test('fix-diagnostics workflow exists and is not a /gate clone', () => {
  const wf = read('.claude/workflows/fix-diagnostics.js');
  assert.match(wf, /export const meta/);
  assert.match(wf, /name: 'fix-diagnostics'/);
  assert.match(wf, /diagnostics-shard/);
  assert.match(wf, /process-rules/);
  assert.match(wf, /edit this workflow|edit the workflow/i);
  assert.doesNotMatch(wf, /security-verdict|sprint.contract/i, 'must not re-implement gate/evaluate machinery');
});

test('workflows README documents the exemplar and process-edit lesson', () => {
  const readme = read('.claude/workflows/README.md');
  assert.match(readme, /fix-diagnostics/);
  assert.match(readme, /Monitor the loop|edit the workflow/i);
});

test('out-of-core Phase C notes exist for fuzz and cgroup', () => {
  assert.ok(exists('docs/proposals/bun-phase-c-out-of-core.md'));
  const doc = read('docs/proposals/bun-phase-c-out-of-core.md');
  assert.match(doc, /[Ff]uzz/);
  assert.match(doc, /cgroup/);
});

test('/implement mentions review-commit-msg after dual review', () => {
  const skill = read('.claude/skills/implement/SKILL.md');
  assert.match(skill, /review-commit-msg\.js/);
});
