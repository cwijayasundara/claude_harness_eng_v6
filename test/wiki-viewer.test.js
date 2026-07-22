'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildWikiModel, render } = require(
  path.join(__dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'wiki_viewer')
);

function sampleFiles() {
  return [
    { rel: 'WIKI.md', md: '# Codebase Wiki\n\n- [helpers](concepts/test__helpers.md)\n- [cluster](pages/01-test.md)' },
    { rel: 'concepts/test__helpers.md', md: '# test/helpers\n\nShared helpers. [back to index](../WIKI.md)' },
    { rel: 'pages/01-test.md', md: '# test cluster\n\nModules under test.' },
  ];
}

test('one page per file with id, title, and group', () => {
  const m = buildWikiModel(sampleFiles(), 'demo');
  assert.deepStrictEqual(m.pages.map((p) => p.id).sort(), ['WIKI.md', 'concepts/test__helpers.md', 'pages/01-test.md']);
  const byId = Object.fromEntries(m.pages.map((p) => [p.id, p]));
  assert.strictEqual(byId['WIKI.md'].title, 'Codebase Wiki');
  assert.strictEqual(byId['WIKI.md'].group, 'overview');
  assert.strictEqual(byId['concepts/test__helpers.md'].group, 'concepts');
  assert.strictEqual(byId['pages/01-test.md'].group, 'pages');
});

test('internal links are resolved to page ids and rewritten to in-app nav', () => {
  const m = buildWikiModel(sampleFiles(), 'demo');
  const byId = Object.fromEntries(m.pages.map((p) => [p.id, p]));
  assert.deepStrictEqual(byId['WIKI.md'].links.sort(), ['concepts/test__helpers.md', 'pages/01-test.md']);
  assert.ok(byId['WIKI.md'].html.includes('data-nav="concepts/test__helpers.md"'));
  // relative ../WIKI.md from a concepts page resolves to WIKI.md
  assert.deepStrictEqual(byId['concepts/test__helpers.md'].links, ['WIKI.md']);
});

test('backlinks are the inverse of links', () => {
  const m = buildWikiModel(sampleFiles(), 'demo');
  const byId = Object.fromEntries(m.pages.map((p) => [p.id, p]));
  assert.deepStrictEqual(byId['WIKI.md'].backlinks, ['concepts/test__helpers.md']);
  assert.deepStrictEqual(byId['concepts/test__helpers.md'].backlinks, ['WIKI.md']);
  assert.deepStrictEqual(byId['pages/01-test.md'].backlinks, ['WIKI.md']);
});

test('a link to a non-page target is not turned into nav', () => {
  const files = [{ rel: 'WIKI.md', md: '# W\n\n[src](../code-graph.json) and [ext](https://x.dev)' }];
  const m = buildWikiModel(files, 'demo');
  assert.deepStrictEqual(m.pages[0].links, []);
  assert.ok(!m.pages[0].html.includes('data-nav'));
});

test('search text is lowercased plain content', () => {
  const m = buildWikiModel(sampleFiles(), 'demo');
  const w = m.pages.find((p) => p.id === 'WIKI.md');
  assert.ok(w.text.includes('codebase wiki'));
  assert.ok(!/[<>]/.test(w.text));
});

test('render injects round-trippable data and substitutes title', () => {
  const m = buildWikiModel(sampleFiles(), 'demo');
  const html = render(m, '<title>__TITLE__</title><script id="wiki-data" type="application/json">__WIKI_DATA__</script>');
  assert.ok(html.includes('<title>wiki browser — demo</title>'));
  const json = html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<');
  assert.strictEqual(JSON.parse(json).pages.length, 3);
  assert.ok(!html.includes('__WIKI_DATA__'));
});
