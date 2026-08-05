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
  'design',   // Step 0 brainstorm + Step 0.5 clarify + the design gate
  'brd',      // five-dimension interview + clarification budget + approval
];

// Phases split into a main-session shaping half and a forked sidekick renderer.
// `guard` is what the renderer must show it refuses to run without. /spec and
// /design have a decisions gate; /brd's confirmed input is the interview and
// clarification record, so its renderer's guard is the standing prohibition on
// clarifying inside a fork — where "clarifying" means answering your own
// question, the pattern that produced a clarification log the human never
// shaped.
const SPLIT_PHASES = [
  { shaping: 'spec', renderer: 'spec-render', guard: /validate-spec-decisions\.js/ },
  { shaping: 'design', renderer: 'design-render', guard: /validate-design-decisions\.js/ },
  { shaping: 'brd', renderer: 'brd-render', guard: /Never invoke `\/clarify` here/i },
];

// /design is an orchestrator index: its dispatch step lives in references/,
// not in SKILL.md, so the assertion has to read the whole skill.
function refs(skill) {
  const dir = path.join(SKILLS_DIR, skill, 'references');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

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

test('each shaping half actually dispatches its renderer — the corpus union must not mask a severed handoff', () => {
  // Wiring contracts read shaping + renderer as one corpus, so an artifact
  // documented in the renderer satisfies them. Without this assertion, deleting
  // the dispatch leaves every one of them green while the phase produces
  // nothing at all.
  for (const { shaping, renderer } of SPLIT_PHASES) {
    const corpus = [
      fs.readFileSync(path.join(SKILLS_DIR, shaping, 'SKILL.md'), 'utf8'),
      ...refs(shaping),
    ].join('\n');
    assert.match(corpus, new RegExp(`Dispatch \`${renderer}\`|Invoke the \`${renderer}\` skill`),
      `/${shaping} must carry an explicit dispatch step for ${renderer}, not just a mention`);
  }
});

test('the renderer half of a split phase does fork — the split must stay real', () => {
  // If a renderer stopped forking, the expensive shaping context would carry
  // the whole rendering volume and the sidekick split would be cosmetic.
  for (const { renderer } of SPLIT_PHASES) {
    assert.match(frontmatter(renderer), /^context:\s*fork\s*$/m, `${renderer} must fork`);
    assert.match(frontmatter(renderer), /^agent:\s*generator\s*$/m,
      `${renderer} must dispatch to the sidekick generator, not the frontier planner`);
  }
});

test('each renderer states what it refuses to run without, so bypassing the shaping half still blocks', () => {
  for (const { renderer, guard } of SPLIT_PHASES) {
    const text = fs.readFileSync(path.join(SKILLS_DIR, renderer, 'SKILL.md'), 'utf8');
    assert.match(text, guard, `${renderer} must carry its own guard, not rely on the caller`);
  }
});

test('no renderer resolves ambiguity itself — a fork can only ask itself', () => {
  for (const { renderer } of SPLIT_PHASES) {
    const text = fs.readFileSync(path.join(SKILLS_DIR, renderer, 'SKILL.md'), 'utf8');
    assert.match(text, /unresolved/i,
      `${renderer} must return unresolved items rather than inventing answers`);
  }
});
