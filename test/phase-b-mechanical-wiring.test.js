'use strict';

// Bun Phase B wiring: diagnostics skill, canary generalization, migrate templates.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('fix-from-diagnostics skill exists and references diagnostics-shard', () => {
  const skill = read('.claude/skills/fix-from-diagnostics/SKILL.md');
  assert.match(skill, /diagnostics-shard\.js/);
  assert.match(skill, /errors\.jsonl/);
  assert.match(skill, /shards\.json/);
  assert.match(skill, /No full monorepo suite between shards/i);
  assert.match(skill, /No stub-to-green/i);
});

test('CORE_SKILLS and CORE_SCRIPTS include Phase B artifacts', () => {
  const copy = read('.claude/scripts/scaffold-copy.js');
  assert.match(copy, /'fix-from-diagnostics'/);
  assert.match(copy, /'diagnostics-shard\.js'/);
});

test('/implement Step 0.5 canaries large or mechanical groups', () => {
  const skill = read('.claude/skills/implement/SKILL.md');
  assert.match(skill, /Step 0\.5/);
  assert.match(skill, /[Cc]anary/);
  assert.match(skill, /more than ~?10 files/);
  assert.match(skill, /fix-from-diagnostics/);
});

test('/feature canaries first ready story for epic work', () => {
  const skill = read('.claude/skills/feature/SKILL.md');
  assert.match(skill, /[Cc]anary story/);
  assert.match(skill, /first ready story/i);
});

test('/refactor --mechanical uses specs/migrate', () => {
  const skill = read('.claude/skills/refactor/SKILL.md');
  assert.match(skill, /--mechanical/);
  assert.match(skill, /specs\/migrate/);
  assert.match(skill, /MAPPING\.md/);
  assert.match(skill, /CANARY\.md/);
});

test('migrate templates exist under .claude/templates/migrate', () => {
  for (const f of ['README.md', 'MAPPING.md', 'CONSTRAINTS.tsv', 'CANARY.md']) {
    assert.ok(exists(`.claude/templates/migrate/${f}`), `missing template ${f}`);
  }
});

test('/auto SECTION 6 routes high-volume type/lint to fix-from-diagnostics', () => {
  const sec = read('.claude/skills/auto/references/section-6-6-pass-fail-handling-steps-6-7.md');
  assert.match(sec, /fix-from-diagnostics/);
  assert.match(sec, /≥ ~15/);
});
