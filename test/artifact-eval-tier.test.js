'use strict';

// Artifact-mode evaluation runs on the sidekick tier, and its result does not
// come back through the caller's context.
//
// Runtime mode — driving a live app and judging whether a feature works — keeps
// the frontier pin. Artifact mode scores planning documents whose load-bearing
// properties were ALREADY proven deterministically (grounding gates, taxonomy
// floor, trace-check, cluster gates); what the rubric adds is prose-level
// consistency. On a metered run that layer helped drive a $118.60 front half in
// which only $12.00 was generated output, and one result file was 47 KB read
// straight back into the shaping session.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CALLERS = {
  brd: '.claude/skills/brd/SKILL.md',
  spec: '.claude/skills/spec/SKILL.md',
  test: '.claude/skills/test/SKILL.md',
  design: '.claude/skills/design/references/mode-10-step-1-spawn-two-agents-concurrently.md',
};

test('the evaluator keeps its frontier pin for runtime mode', () => {
  assert.match(read('.claude/agents/evaluator.md'), /^model: claude-opus-5$/m,
    'runtime evaluation drives a live app — that is where the tier earns its cost');
});

test('artifact mode documents the sidekick tier and the escalation rule', () => {
  const agent = read('.claude/agents/evaluator.md');
  assert.match(agent, /## Model policy \(artifact mode\)/);
  assert.match(agent, /claude-sonnet-5/, 'artifact mode must name the tier it runs on');
  assert.match(agent, /[Ee]scalate back to Opus/,
    'a demotion with no escalation path is a downgrade, not a policy');
  assert.match(agent, /security or data boundary/,
    'the escalation trigger must be stated, not left to taste');
});

test('artifact mode returns a summary and never the result file', () => {
  const agent = read('.claude/agents/evaluator.md');
  assert.match(agent, /## Return contract \(artifact mode\)/);
  assert.match(agent, /caller must not read the result file back/i);
  assert.match(agent, /Do not restate the scores table/i);
});

for (const [phase, file] of Object.entries(CALLERS)) {
  test(`/${phase} spawns artifact-mode evaluation on the sidekick tier`, () => {
    const body = read(file);
    assert.match(body, /model: "sonnet"/,
      `/${phase} must name the tier explicitly — the agent frontmatter pins Opus for runtime mode`);
    assert.match(body, /opus/i, `/${phase} must carry the escalation path too`);
  });

  test(`/${phase} takes the verdict from the return, not the result file`, () => {
    assert.match(
      read(file), /[Dd]o not read\s+`?specs\/reviews\/phase-[a-z-]*eval\.json`?/,
      `/${phase} reading its own eval JSON back re-bills it on every later turn`,
    );
  });
}

test('/design states that architecture is where escalation actually bites', () => {
  const design = read(CALLERS.design);
  assert.match(design, /authn\/authz|tenant-isolation|schema migration/i,
    'the /design escalation triggers must be concrete enough to act on');
  assert.match(design, /escalate on doubt/i,
    'a wrong architecture call is the most expensive kind to unwind');
});
