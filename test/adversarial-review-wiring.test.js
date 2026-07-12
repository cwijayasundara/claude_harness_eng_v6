'use strict';

// Bun Phase A — dual adversarial review wiring (prompt + scripts).
// Same skill-text-assertion pattern as test/gate-reverify-wiring.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/implement resolves review-tier and supports two code-reviewer instances', () => {
  const skill = read('.claude/skills/implement/SKILL.md');
  assert.match(skill, /review-tier\.js/, 'must resolve review mode via review-tier.js');
  assert.match(skill, /two independent/, 'must spawn two independent code-reviewer instances in adversarial mode');
  assert.match(skill, /merge-review-verdicts\.js/, 'must merge with merge-review-verdicts.js');
  assert.match(skill, /union/, 'default merge policy is union');
  assert.match(skill, /fail safe to the stricter outcome/, 'must fail safe on instance error');
  assert.match(
    skill,
    /nothing.*from the builder's reasoning|progress logs/i,
    'reviewers must not get builder reasoning / progress logs'
  );
});

test('/auto Gate 8 documents adversarial dual review', () => {
  const gate = read('.claude/skills/auto/references/section-5-5-ratchet-gate-step-5.md');
  assert.match(gate, /review-tier\.js/);
  assert.match(gate, /two independent/);
  assert.match(gate, /merge-review-verdicts\.js/);
  assert.match(gate, /adversarial-review-audit\.json/);
});

test('/change Step S6 uses the same auto thresholds as implement', () => {
  const skill = read('.claude/skills/change/SKILL.md');
  assert.match(skill, /review-tier\.js/);
  assert.match(skill, /two independent/);
  assert.match(skill, /merge-review-verdicts\.js/);
});

test('code-reviewer has stub-to-green and paragraph-workaround Iron Laws', () => {
  const agent = read('.claude/agents/code-reviewer.md');
  assert.match(agent, /Stub-to-green/);
  assert.match(agent, /Paragraph-workaround rule/);
});

test('code-gen documents no stub-to-green and paragraph rule', () => {
  const skill = read('.claude/skills/code-gen/SKILL.md');
  assert.match(skill, /No stub-to-green/);
  assert.match(skill, /Paragraph rule \(Bun\)/);
});

test('/auto SECTION 4 injects process-rules and git safety', () => {
  const sec = read('.claude/skills/auto/references/section-4-4-agent-team-execution-step-4.md');
  assert.match(sec, /process-rules\.md/);
  assert.match(sec, /git stash/);
  assert.match(sec, /parallel-implement\.lock/);
  assert.match(sec, /HARNESS_PARALLEL_AGENTS/);
});

test('/implement injects process-rules.md', () => {
  const skill = read('.claude/skills/implement/SKILL.md');
  assert.match(skill, /process-rules\.md/);
});

test('merge-review-verdicts and review-tier are on CORE_SCRIPTS', () => {
  const copy = read('.claude/scripts/scaffold-copy.js');
  assert.match(copy, /'merge-review-verdicts\.js'/);
  assert.match(copy, /'review-tier\.js'/);
  assert.match(copy, /'stub-smell-gate\.js'/);
});
