'use strict';

// Static contract for the headless-lite lane (`/build --lite --auto <prd>`).
// Keeps `npm test` green without a live run, like the other e2e contracts.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/build documents the headless-lite lane (--lite --auto)', () => {
  const b = readSkillCorpus('build');
  assert.match(b, /--lite --auto/);
  // It is the cut-down equivalent of --auto: PRD straight to PR, no interview.
  assert.match(b, /headless lite/i);
  assert.match(b, /PRD grounding replaces the interview/i);
});

test('lite lane reference uses /build --lite, not a removed /lite command', () => {
  const lane = read('.claude/skills/build/references/lite-lane.md');
  assert.doesNotMatch(lane, /(^|\s)\/lite\b/);
  assert.match(lane, /\/build --lite/);
});

test('headless lite drops the interview and the approval gate', () => {
  const lane = read('.claude/skills/build/references/lite-lane.md');
  assert.match(lane, /## Headless mode/i);
  // PRD replaces the 5-question interview.
  assert.match(lane, /PRD grounding replaces Step 1/i);
  assert.match(lane, /Do \*\*not\*\* interview|cannot run headless/i);
  // Step 7 approval gate is dropped and /auto is invoked automatically.
  assert.match(lane, /Step 7 is dropped/i);
  assert.match(lane, /invoke `\/auto --group A` directly/i);
});

test('headless lite auto-escalates an oversized PRD instead of cramming it', () => {
  const lane = read('.claude/skills/build/references/lite-lane.md');
  assert.match(lane, /automated gate that auto-escalates/i);
  assert.match(lane, /auto-escalate|Hand off to the full `--auto` pipeline/i);
  // The whole point: do not compress an oversized project into the lite caps.
  assert.match(lane, /\*\*do not\*\* compress it into 5 stories/i);
});

test('headless lite never weakens the machine gates', () => {
  const lane = read('.claude/skills/build/references/lite-lane.md');
  // Ratchet, evaluator, security, and Phase 9.5 all run unchanged.
  assert.match(lane, /machine gates are identical/i);
  assert.match(lane, /compresses \*planning ceremony\*, never verification/i);
});

test('Step 7 and Handoff note the headless exception (internal consistency)', () => {
  const lane = read('.claude/skills/build/references/lite-lane.md');
  assert.match(lane, /Headless exception/i);
  assert.match(lane, /headless lite.*invokes `\/auto --group A` itself/i);
});
