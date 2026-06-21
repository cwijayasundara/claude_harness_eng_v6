'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SCRIPTS = path.join(__dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'code_wiki');
const model = require(path.join(SCRIPTS, 'model'));
const render = require(path.join(SCRIPTS, 'render'));
const query = require(path.join(SCRIPTS, 'query'));

// Two dir-clusters: src/{a,b,c} with a cycle b->c->b, and lib/{d}. Regex-producer schema.
const REGEX_GRAPH = {
  producer: 'manual-regex-fallback', language: 'javascript',
  nodes: [
    { id: 'src/a.js', type: 'module', symbols: [{ name: 'main', kind: 'function', line: 3, signature: 'main()' }] },
    { id: 'src/b.js', type: 'module', symbols: [{ name: 'helper', kind: 'function', line: 7 }] },
    { id: 'src/c.js', type: 'module', symbols: [{ name: 'util', kind: 'function', line: 1 }] },
    { id: 'lib/d.js', type: 'module', symbols: [] },
  ],
  edges: [
    { from: 'src/a.js', to: 'src/b.js', type: 'import', evidence: "src/a.js:1 require('./b')" },
    { from: 'src/b.js', to: 'src/c.js', type: 'import' },
    { from: 'src/c.js', to: 'src/b.js', type: 'import' },
  ],
  cycles: [['src/b.js', 'src/c.js']],
  external_deps: [{ id: 'ext:node:fs', used_by: ['src/a.js'] }],
};

// Real AST/SCIP producer schema: nodes keyed by `path` with BARE-STRING symbols,
// rich per-symbol detail (line via `start`, signature) in top-level files[], edges
// by source/target/kind, prefixed ids. This is the schema the graph-refresh hook targets.
const AST_GRAPH = {
  meta: { producer: 'vendored-ast', language: 'python' },
  nodes: [
    { id: 'py:pkg/x.py', path: 'pkg/x.py', symbols: ['X'] },
    { id: 'py:pkg/y.py', path: 'pkg/y.py', symbols: ['go'] },
  ],
  files: [
    { path: 'pkg/x.py', symbols: [{ name: 'X', kind: 'class', start: 2, end: 9, signature: 'class X:' }] },
    // y.py has a node symbol but no files[] detail → citation must degrade, not lie.
    { path: 'pkg/y.py', symbols: [] },
  ],
  edges: [{ source: 'py:pkg/y.py', target: 'py:pkg/x.py', kind: 'calls' }],
};

test('model: normalizes regex schema, derives clusters/hubs/cycles', () => {
  const m = model.build(REGEX_GRAPH);
  assert.strictEqual(m.nodes.length, 4);
  assert.strictEqual(m.edges.length, 3);
  assert.strictEqual(m.producer, 'manual-regex-fallback');
  // Two directory clusters: src/ (3) and lib/ (1); largest first.
  assert.strictEqual(m.clusters.length, 2);
  assert.deepStrictEqual(m.clusters[0], { key: 'src', ids: ['src/a.js', 'src/b.js', 'src/c.js'] });
  assert.deepStrictEqual(m.clusters[1], { key: 'lib', ids: ['lib/d.js'] });
  // Fan-in: src/b.js has 2 inbound (a,c); it's the top hub.
  assert.strictEqual(m.fanIn.get('src/b.js'), 2);
  assert.strictEqual(m.hubs[0].id, 'src/b.js');
  // src/a.js and lib/d.js have no inbound → entry points.
  assert.deepStrictEqual(m.entrypoints, ['lib/d.js', 'src/a.js']);
  assert.deepStrictEqual(m.cycles, [['src/b.js', 'src/c.js']]);
});

test('model: normalizes AST/SCIP schema (path + source/target/kind + meta)', () => {
  const m = model.build(AST_GRAPH);
  assert.strictEqual(m.producer, 'vendored-ast');
  assert.strictEqual(m.language, 'python');
  assert.strictEqual(m.edges[0].from, 'py:pkg/y.py');
  assert.strictEqual(m.edges[0].to, 'py:pkg/x.py');
  assert.strictEqual(m.edges[0].type, 'calls');
  assert.strictEqual(m.fanIn.get('py:pkg/x.py'), 1);
});

test('model: AST symbol detail comes from files[] (line via start), degrades when absent', () => {
  const m = model.build(AST_GRAPH);
  // x.py: rich files[] record → real line + signature.
  const x = m.byId.get('py:pkg/x.py');
  assert.deepStrictEqual(x.symbols, [{ name: 'X', kind: 'class', line: 2, signature: 'class X:' }]);
  // y.py: bare-string node symbol, no files[] detail → name kept, line null (no fabricated position).
  const y = m.byId.get('py:pkg/y.py');
  assert.deepStrictEqual(y.symbols, [{ name: 'go', kind: 'symbol', line: null, signature: null }]);
});

test('render: AST graph cites real lines and never emits an undefined citation', () => {
  const m = model.build(AST_GRAPH);
  const wiki = render.renderWiki(m);
  const all = wiki.pages.map((p) => p.md).join('\n');
  assert.match(all, /`X` \(class\) → py:pkg\/x\.py:2 — `class X:`/); // rich citation
  assert.match(all, /`go` \(symbol\) → py:pkg\/y\.py$/m); // degraded: no ":undefined"
  assert.doesNotMatch(all, /:undefined/);
});

test('query: symbol resolves against AST string-symbol graph', () => {
  const m = model.build(AST_GRAPH);
  assert.deepStrictEqual(query.symbol(m, 'X'), [{ file: 'py:pkg/x.py', line: 2, kind: 'class', signature: 'class X:' }]);
  assert.strictEqual(query.symbol(m, 'go')[0].line, null);
});

test('render: escapes untrusted graph strings (no markdown/mermaid injection)', () => {
  const evil = {
    producer: 'x', language: 'js',
    nodes: [{ id: 'src/a.js', symbols: [{ name: 'f', kind: 'fn', line: 1, signature: '`); \n## Forged Heading' }] }],
    edges: [],
    cycles: [['src/a.js\n## Cycle Heading']],
  };
  const wiki = render.renderWiki(model.build(evil));
  const all = wiki.index.md + '\n' + wiki.pages.map((p) => p.md).join('\n');
  assert.doesNotMatch(all, /\n## Forged Heading/); // newline collapsed, no injected heading
  assert.doesNotMatch(all, /\n## Cycle Heading/);
});

test('render: WIKI.md overview lists hubs, entry points, cycles, pages', () => {
  const m = model.build(REGEX_GRAPH);
  const wiki = render.renderWiki(m);
  assert.strictEqual(wiki.index.name, 'WIKI.md');
  const md = wiki.index.md;
  assert.match(md, /## Hubs/);
  assert.match(md, /`src\/b\.js` \| 2 \| 1/); // hub row with fan counts
  assert.match(md, /src\/b\.js → src\/c\.js/); // cycle rendered
  assert.match(md, /ext:node:fs/); // external dep by id, not raw JSON
  assert.strictEqual(wiki.pages.length, 2); // one page per directory cluster
});

test('render: cluster pages carry file:line citations and a mermaid graph', () => {
  const m = model.build(REGEX_GRAPH);
  const wiki = render.renderWiki(m);
  const big = wiki.pages.find((p) => p.name.endsWith('-src.md')); // src/ cluster
  assert.ok(big, 'expected a cluster page for src/');
  assert.match(big.md, /`main` \(function\) → src\/a\.js:3/); // citation
  assert.match(big.md, /```mermaid/);
  assert.match(big.md, /-->\|import\|/); // edge in the diagram
});

test('render: caps pages at maxPages and notes the overflow', () => {
  const m = model.build(REGEX_GRAPH);
  const wiki = render.renderWiki(m, { maxPages: 1 });
  assert.strictEqual(wiki.pages.length, 1);
  assert.match(wiki.index.md, /1 smaller cluster\(s\) not paged/);
});

test('query: callers, calls, symbol, module', () => {
  const m = model.build(REGEX_GRAPH);
  assert.deepStrictEqual(query.callers(m, 'src/b.js').map((c) => c.from).sort(), ['src/a.js', 'src/c.js']);
  assert.deepStrictEqual(query.calls(m, 'src/a.js'), [{ to: 'src/b.js', type: 'import', evidence: "src/a.js:1 require('./b')" }]);
  assert.deepStrictEqual(query.symbol(m, 'main'), [{ file: 'src/a.js', line: 3, kind: 'function', signature: 'main()' }]);
  const view = query.moduleView(m, 'src/b.js');
  assert.strictEqual(view.fanIn, 2);
  assert.strictEqual(view.calls.length, 1);
  assert.strictEqual(query.moduleView(m, 'nope.js'), null);
});

test('query.run: dispatches by flag and falls back to overview', () => {
  const m = model.build(REGEX_GRAPH);
  assert.strictEqual(query.run(m, { callers: 'src/b.js' }).query, 'callers');
  assert.strictEqual(query.run(m, { symbol: 'main' }).query, 'symbol');
  const ov = query.run(m, {});
  assert.strictEqual(ov.query, 'overview');
  assert.strictEqual(ov.result.nodes, 4);
});
