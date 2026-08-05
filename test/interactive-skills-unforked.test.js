/**
 * Interactive skills must run in the main session.
 *
 * A forked skill cannot pause for `AskUserQuestion` and returns a single
 * result, so `context: fork` on a skill that owns a human gate does not fail —
 * it silently converts the gate into prose the model reads to itself.
 *
 * This was not hypothetical. `/build` carried `context: fork` while owning four
 * gated stops; a real run produced no `brd-approval.json`, no
 * `design-approval.json`, and left five design questions queued for a human who
 * was never asked. `/feature` and `/sprint` already carried a prose warning
 * about exactly this, and nothing enforced it.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const SKILLS_DIR = path.join(__dirname, '..', '.claude', 'skills');

// Skills that stop and ask a human, either directly or by owning a gate whose
// sub-skill asks. Adding a skill here is a claim that it must reach the user.
const MUST_STAY_INTERACTIVE = [
  'build',    // human gates on Phases 1-3
  'feature',  // three interactive gates + git workflow
  'sprint',   // GATE 1 + GATE 2
  'spec',     // decision dialogue (Step 3) + plan-review-loop (Step 8)
];

function frontmatter(skill) {
  const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, `${skill}/SKILL.md has no frontmatter`);
  return match[1];
}

test('skills that own a human gate never declare context: fork', () => {
  const forked = MUST_STAY_INTERACTIVE.filter((s) => /^context:\s*fork\s*$/m.test(frontmatter(s)));
  assert.deepStrictEqual(forked, [],
    `these skills own human gates but run forked, which disables every question: ${forked.join(', ')}`);
});

test('each interactive skill states the rule so the next editor sees it', () => {
  const missing = MUST_STAY_INTERACTIVE.filter((skill) => {
    const text = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    return !/do not add `context: fork`/i.test(text);
  });
  assert.deepStrictEqual(missing, [],
    `missing the main-session note: ${missing.join(', ')}`);
});

test('the renderer half of a split phase does fork — the split must stay real', () => {
  // If spec-render stopped forking, the expensive shaping context would carry
  // the whole rendering volume and the sidekick split would be cosmetic.
  assert.match(frontmatter('spec-render'), /^context:\s*fork\s*$/m);
  assert.match(frontmatter('spec-render'), /^agent:\s*generator\s*$/m,
    'spec-render must dispatch to the sidekick generator, not the frontier planner');
});
