'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const { buildGraphifyGraph } = require(
  path.join(__dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'import_graphify_graph')
);

const FIXTURE = path.join(__dirname, 'fixtures', 'graphify', 'sample-graph.json');
const graphify = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function edgeSet(graph) {
  return new Set(graph.edges.map((e) => `${e.source} ${e.kind} ${e.target}`));
}

test('produces one file node per source_file among "code" nodes, path-sorted, tagged graphify', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  assert.strictEqual(g.meta.producer, 'graphify');
  assert.deepStrictEqual(
    g.nodes.map((n) => n.path),
    ['src/api/routes.py', 'src/service/base.py', 'src/service/user_service.py']
  );
  assert.ok(g.nodes.every((n) => n.language === 'python' && n.id.startsWith('py:')));
});

test('rationale nodes and file-self labels are excluded from symbols', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  const userService = g.nodes.find((n) => n.path === 'src/service/user_service.py');
  assert.deepStrictEqual(userService.symbols, ['.get_user()', 'UserService']);
});

test('resolves imports_from, calls, and inherits into cross-file edges', () => {
  const edges = edgeSet(buildGraphifyGraph(graphify, FIXTURE));
  assert.ok(edges.has('py:src/api/routes.py imports py:src/service/user_service.py'));
  assert.ok(edges.has('py:src/api/routes.py calls py:src/service/user_service.py'));
  assert.ok(edges.has('py:src/service/user_service.py inherits py:src/service/base.py'));
});

test('duplicate symbol-level links collapse to one file-level edge', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  const callsEdges = g.edges.filter(
    (e) => e.source === 'py:src/api/routes.py' && e.target === 'py:src/service/user_service.py' && e.kind === 'calls'
  );
  assert.strictEqual(callsEdges.length, 1, 'two calls links between the same file pair dedup to one edge');
});

test('contains, method, uses, and rationale_for relations are dropped, not guessed at', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  assert.ok(!g.edges.some((e) => /base_service_BaseService|user_service_rationale_1/.test(e.evidence)));
  assert.strictEqual(g.edges.length, 3, 'only imports_from + calls + inherits survive');
});

test('unresolved external symbols (no source_file) create no edges', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  assert.ok(!g.edges.some((e) => e.target === 'typing' || e.source === 'typing'));
});

test('evidence preserves confidence and 1-indexed line location', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  const inherits = g.edges.find((e) => e.kind === 'inherits');
  assert.strictEqual(inherits.evidence, 'src/service/user_service.py:8 inherits src/service/base.py [EXTRACTED]');
});

test('metrics count internal edges and find no cycle in the acyclic sample', () => {
  const g = buildGraphifyGraph(graphify, FIXTURE);
  assert.strictEqual(g.metrics.files, 3);
  assert.strictEqual(g.metrics.edges, 3);
  assert.deepStrictEqual(g.metrics.cycles, []);
});

test('non-AST languages (rust, ruby, ...) Graphify can parse survive as nodes and edges', () => {
  // The vendored AST indexer only covers py/js/ts/java/cs/go. Graphify's value
  // as a fallback producer is precisely the languages it cannot parse, so those
  // must become graph nodes rather than being dropped as "unknown".
  const poly = {
    nodes: [
      { id: 'm', label: 'main.rs', file_type: 'code', source_file: 'src/main.rs', source_location: 'L1' },
      { id: 'm_run', label: 'run', file_type: 'code', source_file: 'src/main.rs', source_location: 'L3' },
      { id: 'l', label: 'lib.rs', file_type: 'code', source_file: 'src/lib.rs', source_location: 'L1' },
      { id: 'l_helper', label: 'helper', file_type: 'code', source_file: 'src/lib.rs', source_location: 'L2' },
      { id: 'w', label: 'worker.rb', file_type: 'code', source_file: 'app/worker.rb', source_location: 'L1' },
    ],
    links: [
      { relation: 'calls', confidence: 'EXTRACTED', source_file: 'src/main.rs', source_location: 'L4', source: 'm_run', target: 'l_helper' },
    ],
  };
  const g = buildGraphifyGraph(poly, 'poly.json');
  const rust = g.nodes.filter((n) => n.language === 'rust').map((n) => n.id).sort();
  assert.deepStrictEqual(rust, ['rs:src/lib.rs', 'rs:src/main.rs']);
  assert.ok(g.nodes.some((n) => n.language === 'ruby' && n.id === 'rb:app/worker.rb'));
  const edges = new Set(g.edges.map((e) => `${e.source} ${e.kind} ${e.target}`));
  assert.ok(edges.has('rs:src/main.rs calls rs:src/lib.rs'), 'cross-file rust call edge resolves');
});

test('genuinely unrecognized extensions are still skipped, not invented', () => {
  const g = buildGraphifyGraph({
    nodes: [{ id: 'x', label: 'weird.xyzq', file_type: 'code', source_file: 'a/weird.xyzq', source_location: 'L1' }],
    links: [],
  }, 'unknown.json');
  assert.strictEqual(g.nodes.length, 0);
  assert.ok(g.meta.warnings.some((w) => /weird\.xyzq/.test(w)));
});

test('cycle detection works on a mutually-referencing graphify graph', () => {
  const cyclic = {
    nodes: [
      { id: 'a', label: 'a.py', file_type: 'code', source_file: 'a.py', source_location: 'L1' },
      { id: 'a_A', label: 'A', file_type: 'code', source_file: 'a.py', source_location: 'L1' },
      { id: 'b', label: 'b.py', file_type: 'code', source_file: 'b.py', source_location: 'L1' },
      { id: 'b_B', label: 'B', file_type: 'code', source_file: 'b.py', source_location: 'L1' },
    ],
    links: [
      { relation: 'calls', confidence: 'EXTRACTED', source_file: 'a.py', source_location: 'L2', source: 'a_A', target: 'b_B' },
      { relation: 'calls', confidence: 'EXTRACTED', source_file: 'b.py', source_location: 'L2', source: 'b_B', target: 'a_A' },
    ],
  };
  const g = buildGraphifyGraph(cyclic, 'cyclic.json');
  assert.strictEqual(g.metrics.cycles.length, 1, 'detects the a.py <-> b.py cycle');
  assert.deepStrictEqual(g.metrics.cycles[0].sort(), ['py:a.py', 'py:b.py']);
});
