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
    // Negation lines (leading `!`) are how gitignore expresses "ignore this
    // directory broadly, except this path" — the standard idiom for keeping
    // one committed subtree (the wiki) out of an otherwise-ignored parent
    // (specs/). Strip them before checking for an actual ignore of the wiki,
    // so an intentional `!specs/brownfield/wiki/` carve-out doesn't trip a
    // check whose purpose is exactly to guarantee that carve-out exists.
    const ignoreLines = ig.split('\n').filter((l) => !l.trim().startsWith('!'));
    const ignoreOnly = ignoreLines.join('\n');
    assert.doesNotMatch(ignoreOnly, /specs\/brownfield\/wiki/, `${rel} must not ignore the committed wiki`);
    assert.doesNotMatch(ignoreOnly, /^\s*specs\/brownfield\/?\s*$/m, `${rel} must not ignore specs/brownfield wholesale`);
    // Glob ignore forms that would also sweep up the committed wiki, e.g.
    // `specs/brownfield/**`, `specs/brownfield/*`, `specs/brownfield/*/`.
    assert.doesNotMatch(ignoreOnly, /^\s*specs\/brownfield\/\*{1,2}\/?\s*$/m, `${rel} must not ignore specs/brownfield via a glob`);
    // If specs/ or specs/brownfield/ is ignored wholesale (wildcard form),
    // the wiki carve-out must actually be present — catches the case where
    // someone adds the broad ignore and forgets to re-include the wiki.
    if (/^\s*\/?specs\/\*/m.test(ig) || /^\s*\/?specs\/brownfield\/\*/m.test(ig)) {
      assert.match(ig, /^\s*!\/?specs\/brownfield\/wiki\/?\s*$/m,
        `${rel} ignores specs/ broadly but never re-includes specs/brownfield/wiki/`);
    }
  }
});

test('code-map SKILL documents the /feature-owned committed-wiki lifecycle', () => {
  const cm = read('.claude/skills/code-map/SKILL.md');
  assert.match(cm, /committed/i);
  assert.match(cm, /\/feature/);
  assert.match(cm, /incrementally|--files/);
});
