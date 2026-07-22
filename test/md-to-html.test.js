'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { mdToHtml } = require(
  path.join(__dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'md_to_html')
);

test('headings render at the right level', () => {
  assert.strictEqual(mdToHtml('# Title'), '<h1>Title</h1>');
  assert.ok(mdToHtml('### Deep').includes('<h3>Deep</h3>'));
});

test('inline: bold, italic, code, link', () => {
  assert.ok(mdToHtml('a **b** c').includes('<strong>b</strong>'));
  assert.ok(mdToHtml('a *b* c').includes('<em>b</em>'));
  assert.ok(mdToHtml('use `x` now').includes('<code>x</code>'));
  assert.ok(mdToHtml('[label](concepts/x.md)').includes('<a href="concepts/x.md">label</a>'));
});

test('unordered and ordered lists', () => {
  assert.strictEqual(mdToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(mdToHtml('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

test('tables render header + body cells', () => {
  const h = mdToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
  assert.ok(h.includes('<table>'));
  assert.ok(h.includes('<th>A</th>') && h.includes('<th>B</th>'));
  assert.ok(h.includes('<td>1</td>') && h.includes('<td>2</td>'));
});

test('blockquote and fenced code', () => {
  assert.ok(mdToHtml('> note here').includes('<blockquote>note here</blockquote>'));
  const code = mdToHtml('```\nconst x = 1;\n```');
  assert.ok(code.includes('<pre><code>') && code.includes('const x = 1;'));
});

test('paragraphs group consecutive lines and break on blank', () => {
  const h = mdToHtml('one\ntwo\n\nthree');
  assert.ok(/<p>one\s+two<\/p>/.test(h));
  assert.ok(h.includes('<p>three</p>'));
});

test('html in content is escaped (no injection)', () => {
  const h = mdToHtml('a <script>alert(1)</script> b');
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;'));
});

test('dangerous link schemes are neutralized to #', () => {
  const h = mdToHtml('[x](javascript:doEvil)');
  assert.ok(!/href="javascript:/i.test(h));
  assert.ok(h.includes('href="#"'));
  // safe schemes and relative paths are untouched
  assert.ok(mdToHtml('[a](https://x.dev)').includes('href="https://x.dev"'));
  assert.ok(mdToHtml('[b](pages/01.md)').includes('href="pages/01.md"'));
  assert.ok(mdToHtml('[c](../WIKI.md)').includes('href="../WIKI.md"'));
});

test('entity-encoded scheme cannot bypass the href allowlist', () => {
  assert.ok(!/href="[^"]*javascript/i.test(mdToHtml('[x](&#106;avascript:alert(1))')));
  assert.ok(!/href="[^"]*javascript/i.test(mdToHtml('[x](&#x6a;avascript:alert(1))')));
  assert.ok(mdToHtml('[x](&#106;avascript:alert(1))').includes('href="#"'));
});

test('code fences do not interpret markdown inside', () => {
  const h = mdToHtml('```\n**not bold**\n```');
  assert.ok(h.includes('**not bold**'));
  assert.ok(!h.includes('<strong>'));
});
