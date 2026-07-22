'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildModel, render } = require(
  path.join(__dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'graph_viewer')
);

function sampleGraph() {
  return {
    nodes: [
      { id: 'py:b.py', kind: 'file', language: 'python', path: 'b.py', symbols: ['g'] },
      { id: 'py:a.py', kind: 'file', language: 'python', path: 'a.py', symbols: ['f'] },
      { id: 'ext:os', kind: 'external', path: 'os' },
    ],
    edges: [
      { source: 'py:a.py', target: 'py:b.py', kind: 'imports', evidence: 'a imports b' },
      { source: 'py:a.py', target: 'py:b.py', kind: 'imports', evidence: 'duplicate' },
      { source: 'py:a.py', target: 'ext:os', kind: 'imports', evidence: 'a imports os' },
      { source: 'py:a.py', target: 'py:a.py', kind: 'imports', evidence: 'self loop' },
    ],
    files: [
      { path: 'a.py', loc: 10, language: 'python', symbols: [{ name: 'f', kind: 'function', start: 3, end: 8, signature: 'def f()' }] },
      { path: 'b.py', loc: 4, language: 'python', symbols: [{ name: 'g', kind: 'function', start: 1, end: 2, signature: 'def g()' }] },
    ],
    metrics: { external_imports: 1, cycles: [] },
    meta: { generated_at: '2026-07-22T00:00:00Z', producer: 'vendored-ast' },
  };
}

test('nodes are external-filtered and path-sorted', () => {
  const m = buildModel(sampleGraph(), 'demo');
  assert.deepStrictEqual(m.nodes.map((n) => n.p), ['a.py', 'b.py']);
  assert.ok(m.nodes.every((n) => !String(n.p).startsWith('ext:')));
});

test('fan-in / fan-out counted from internal edges only', () => {
  const m = buildModel(sampleGraph(), 'demo');
  const a = m.nodes.find((n) => n.p === 'a.py');
  const b = m.nodes.find((n) => n.p === 'b.py');
  assert.strictEqual(a.fout, 1);
  assert.strictEqual(b.fin, 1);
  assert.strictEqual(a.fin, 0);
});

test('duplicate and self-loop edges are dropped; external target becomes an ext dep', () => {
  const m = buildModel(sampleGraph(), 'demo');
  assert.strictEqual(m.edges.length, 1);
  assert.deepStrictEqual(m.edges[0], [0, 1, 0]); // a->b imports, index-based
  assert.deepStrictEqual(m.nodes.find((n) => n.p === 'a.py').ext, ['os']);
});

test('symbols carry signature + line range from files[]', () => {
  const m = buildModel(sampleGraph(), 'demo');
  const a = m.nodes.find((n) => n.p === 'a.py');
  assert.deepStrictEqual(a.sym[0], { n: 'f', g: 'def f()', s: 3, e: 8, k: 'function' });
});

test('hub flag trips at the fan-in threshold', () => {
  const g = sampleGraph();
  // make 8 files all import b.py so b crosses the hub threshold
  for (let i = 0; i < 8; i++) {
    g.nodes.push({ id: `py:h${i}.py`, kind: 'file', language: 'python', path: `h${i}.py`, symbols: [] });
    g.edges.push({ source: `py:h${i}.py`, target: 'py:b.py', kind: 'imports', evidence: 'x' });
  }
  const m = buildModel(g, 'demo');
  assert.strictEqual(m.nodes.find((n) => n.p === 'b.py').hub, true);
  assert.strictEqual(m.nodes.find((n) => n.p === 'a.py').hub, false);
});

test('stats summarize the model', () => {
  const m = buildModel(sampleGraph(), 'demo');
  assert.strictEqual(m.stats.files, 2);
  assert.strictEqual(m.stats.internalEdges, 1);
  assert.strictEqual(m.stats.externalImports, 1);
  assert.strictEqual(m.stats.cycles, 0);
});

test('render injects round-trippable JSON and substitutes the title', () => {
  const m = buildModel(sampleGraph(), 'demo');
  const template = '<title>__TITLE__</title><script id="graph-data" type="application/json">__GRAPH_DATA__</script>';
  const html = render(m, template);
  assert.ok(html.includes('<title>code-graph explorer — demo</title>'));
  const json = html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<');
  const back = JSON.parse(json);
  assert.deepStrictEqual(back.nodes.map((n) => n.p), ['a.py', 'b.py']);
  assert.ok(!html.includes('__GRAPH_DATA__') && !html.includes('__TITLE__'));
});

test('render escapes < in embedded data so it cannot break out of the script tag', () => {
  const g = sampleGraph();
  g.files[0].symbols[0].signature = 'def f() -> List<int>'; // contains a raw <
  const m = buildModel(g, 'demo');
  const html = render(m, '<script id="graph-data" type="application/json">__GRAPH_DATA__</script>');
  assert.ok(!/<\/script>.*<int>/s.test(html)); // no unescaped breakout
  assert.ok(html.includes('List\\u003cint>'));
});
