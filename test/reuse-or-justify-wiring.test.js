'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { readSkillCorpus } = require('./helpers/skill-corpus');
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

test('skill self-grounds on reuse-scout and records via record-reuse-decision', () => {
  const text = read(SKILL);
  assert.match(text, /reuse-scout\.js/, 'runs reuse-scout for the fire decision');
  assert.match(text, /record-reuse-decision\.js/, 'records the resolved decision');
});

test('skill gates both ways: fire:false silently records net-new; fire:true interrogates', () => {
  const text = read(SKILL);
  // The fire:false branch must still write a record (the provenance-completeness
  // fix) — assert the net-new record instruction sits with the fire:false case,
  // so an edit that drops it (the original inert bug) fails here.
  assert.match(text, /`fire: false`[\s\S]{0,400}record-reuse-decision\.js --story <id> --decision net-new/,
    'fire:false must record a net-new decision, not merely "note and proceed"');
  assert.match(text, /`fire: true`[\s\S]{0,200}interrogate/i, 'fire:true must interrogate');
  // Guards against the inverted-gate regression class (interrogating on fire:false).
  assert.match(text, /Do not interrogate on `fire: false`/, 'must not interrogate on fire:false');
});

test('skill passes --band to the recorder (durable confidence for P2)', () => {
  assert.match(read(SKILL), /--band/, 'records reuse-scout band');
});

test('skill is not a tombstone', () => {
  assert.ok(!/\[Reference, not a command\]|do not invoke this skill/i.test(read(SKILL)));
});

for (const skill of ['change', 'feature', 'sprint']) {
  test(`/${skill} intake invokes reuse-or-justify and does not pre-run reuse-scout itself`, () => {
    const corpus = readSkillCorpus(skill);
    assert.match(corpus, /reuse-or-justify/, `/${skill} must invoke the reuse-or-justify dialogue`);
    // The sub-skill owns grounding now — a caller that runs reuse-scout.js itself
    // reintroduces the double-run / caller-pre-gate split the review flagged.
    assert.doesNotMatch(corpus, /reuse-scout\.js/, `/${skill} must delegate grounding to the sub-skill, not run reuse-scout itself`);
  });
}
