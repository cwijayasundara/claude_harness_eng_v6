'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('wiki path is NOT excluded by .gitignore or gitignore.template', () => {
  for (const rel of ['.gitignore', '.claude/templates/gitignore.template']) {
    const ig = read(rel);
    assert.doesNotMatch(ig, /specs\/brownfield\/wiki/, `${rel} must not ignore the committed wiki`);
    assert.doesNotMatch(ig, /^\s*specs\/brownfield\/?\s*$/m, `${rel} must not ignore specs/brownfield wholesale`);
    // Glob ignore forms that would also sweep up the committed wiki, e.g.
    // `specs/brownfield/**`, `specs/brownfield/*`, `specs/brownfield/*/`.
    assert.doesNotMatch(ig, /^\s*specs\/brownfield\/\*{1,2}\/?\s*$/m, `${rel} must not ignore specs/brownfield via a glob`);
  }
});

test('code-map SKILL documents the /feature-owned committed-wiki lifecycle', () => {
  const cm = read('.claude/skills/code-map/SKILL.md');
  assert.match(cm, /committed/i);
  assert.match(cm, /\/feature/);
  assert.match(cm, /incrementally|--files/);
});
