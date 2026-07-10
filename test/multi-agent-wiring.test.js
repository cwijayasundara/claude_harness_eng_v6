'use strict';

// Deterministic proof of the multi-agent DELEGATION CONTRACT — the wiring that
// must hold for delegated execution, review handoff, and GAN separation to be
// possible. This does NOT prove a live multi-agent run end-to-end (that needs
// the model-gated e2e in test/e2e/); it proves the contract that run depends on,
// which is why multi_agent_claims is "partially_proven", not "proven".

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('agent-teams execution is enabled in settings (delegation cannot run without it)', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  assert.strictEqual(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
});

test('generator can spawn teammates: it declares the Agent tool', () => {
  const g = read('.claude/agents/generator.md');
  const frontmatter = g.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.match(frontmatter, /^\s*-\s*Agent\s*$/m, 'generator must have the Agent tool to delegate');
});

test('generator mandates one teammate per story for multi-story groups, with spawn evidence', () => {
  const g = read('.claude/agents/generator.md');
  assert.match(g, /2 or more stories/i, 'declares the multi-story threshold');
  assert.match(g, /one teammate per story/i, 'mandates a teammate per story');
  assert.match(g, /subagent_type:\s*`?generator`?/i, 'teammates are generator subagents');
  assert.match(g, /iteration-log\.md/, 'logs each spawn as execution evidence');
});

test('review handoff: the generator never self-evaluates', () => {
  const g = read('.claude/agents/generator.md');
  assert.match(g, /Never self-evaluate/i, 'generator hands off rather than grading itself');
  assert.match(g, /hand off|hand off a commit/i, 'hands a commit to the evaluator');
});

test('GAN separation: the evaluator declares it never generates', () => {
  const e = read('.claude/agents/evaluator.md');
  assert.match(e, /Never generates|only evaluates/i, 'evaluator is verify-only');
});

test('the /auto orchestrator delegates generation and verification to separate agents', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /delegated to the \*\*generator\*\*/i, 'generation is delegated, not done inline');
  assert.match(auto, /delegated to the \*\*evaluator\*\*/i, 'verification is delegated to a distinct agent');
});
