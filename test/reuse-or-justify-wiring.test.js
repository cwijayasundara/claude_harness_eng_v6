'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, '.claude/skills/reuse-or-justify/SKILL.md');
const read = (p) => fs.readFileSync(p, 'utf8');

test('reuse-or-justify skill exists with valid frontmatter + internal-discipline marker', () => {
  assert.ok(fs.existsSync(SKILL));
  const text = read(SKILL);
  assert.match(text, /^---\n/, 'opens with frontmatter fence');
  assert.match(text, /^name:\s*reuse-or-justify\b/m, 'has name');
  const desc = (text.match(/^description:\s*(.+)$/m) || [])[1] || '';
  assert.match(desc, /^Use when/, 'description starts with "Use when"');
  assert.match(desc, /\[Internal discipline — .+power-user path\.\]$/, 'carries the internal-discipline marker');
});

test('skill invokes reuse-scout for grounding and records via record-reuse-decision', () => {
  const text = read(SKILL);
  assert.match(text, /reuse-scout\.js/, 'runs reuse-scout for the fire decision');
  assert.match(text, /record-reuse-decision\.js/, 'records the resolved decision');
  assert.match(text, /fire/, 'branches on the fire signal');
});

test('skill is not a tombstone', () => {
  assert.ok(!/\[Reference, not a command\]|do not invoke this skill/i.test(read(SKILL)));
});
