'use strict';

// The authoring checklist exists in two places on purpose:
//   docs/prompting-standards.md  — the standard a human reads
//   .claude/skills/author-prompt-surface/SKILL.md — the control an agent applies
// The skill is what actually gates an edit to any agent/skill/command prompt, so
// if the two drift the harness enforces a rule the standard no longer states (or
// silently stops enforcing one it does). That drift happened and was caught by
// hand, not by a test — this is the test.
//
// It compares the two lists positionally: they are maintained in the same order,
// and same-order is the cheapest property that stays meaningful. Wording is
// deliberately allowed to differ (the skill's phrasing is terser), so pairs are
// matched on shared distinctive tokens rather than exact text. Observed overlap
// across the real pairs is 5-12 tokens; the floor below sits clear of that, while
// a genuinely different rule swapped into one file shares almost nothing.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const STANDARD = path.join(ROOT, 'docs', 'prompting-standards.md');
const SKILL = path.join(ROOT, '.claude', 'skills', 'author-prompt-surface', 'SKILL.md');

const MIN_SHARED_TOKENS = 3;

// Words too generic to evidence that two items mean the same thing.
const STOPWORDS = new Set(['that', 'this', 'with', 'from', 'have', 'must', 'only',
  'when', 'each', 'then', 'them', 'they', 'into', 'your', 'what', 'which']);

function checklistItems(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^\s*-\s*\[\s*\]/.test(l))
    .map((l) => l.replace(/^\s*-\s*\[\s*\]\s*/, '').trim());
}

function distinctiveTokens(item) {
  const flat = item.toLowerCase().replace(/[`*_"“”]/g, ' ').replace(/[^a-z0-9/\- ]/g, ' ');
  return new Set(flat.split(/[\s/]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

// A parser that silently returns nothing would make every assertion below pass
// while checking nothing — the vacuous-green failure mode the harness treats as a
// defect in its own sensors. Fail loudly on empty input instead.
test('both checklists are found and non-empty', () => {
  for (const [label, file] of [['standard', STANDARD], ['skill', SKILL]]) {
    const items = checklistItems(file);
    assert.ok(items.length >= 5,
      `${label} (${path.relative(ROOT, file)}): expected a checklist, parsed ${items.length} items — ` +
      'the section was renamed or its "- [ ]" format changed, so this test was checking nothing');
  }
});

test('the skill checklist mirrors the standard item-for-item', () => {
  const std = checklistItems(STANDARD);
  const skill = checklistItems(SKILL);
  assert.strictEqual(skill.length, std.length,
    `checklist length drift: docs/prompting-standards.md has ${std.length} items, ` +
    `author-prompt-surface/SKILL.md has ${skill.length}. A rule was added or removed on one side only.`);
});

test('each checklist item pairs with its counterpart', () => {
  const std = checklistItems(STANDARD);
  const skill = checklistItems(SKILL);
  const drift = [];
  for (let i = 0; i < Math.min(std.length, skill.length); i++) {
    const a = distinctiveTokens(std[i]);
    const shared = [...distinctiveTokens(skill[i])].filter((w) => a.has(w));
    if (shared.length < MIN_SHARED_TOKENS) {
      drift.push(`item ${i + 1} (${shared.length} shared token(s), need ${MIN_SHARED_TOKENS})\n` +
        `  standard: ${std[i]}\n  skill:    ${skill[i]}`);
    }
  }
  assert.deepStrictEqual(drift, [],
    `checklist items no longer correspond — one side was reworded into a different rule ` +
    `or the two lists fell out of order:\n${drift.join('\n')}`);
});
