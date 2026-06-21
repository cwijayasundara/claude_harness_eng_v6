'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const { buildScipGraph, displayNameOf } = require(
  path.join(__dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'import_scip_graph')
);

const FIXTURE = path.join(__dirname, 'fixtures', 'scip', 'sample-index.json');
const scip = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function edgeSet(graph) {
  return new Set(graph.edges.map((e) => `${e.source} ${e.kind} ${e.target}`));
}

test('produces one file node per SCIP document, path-sorted, tagged scip', () => {
  const g = buildScipGraph(scip, FIXTURE);
  assert.strictEqual(g.meta.producer, 'scip');
  assert.deepStrictEqual(
    g.nodes.map((n) => n.path),
    ['src/api/routes.py', 'src/repository/users.py', 'src/service/base.py', 'src/service/user_service.py']
  );
  assert.ok(g.nodes.every((n) => n.language === 'python' && n.id.startsWith('py:')));
});

test('symbols are attached to their defining file from SymbolInformation', () => {
  const g = buildScipGraph(scip, FIXTURE);
  const svc = g.nodes.find((n) => n.path === 'src/service/user_service.py');
  assert.deepStrictEqual(svc.symbols, ['UserService']);
});

test('resolves cross-file import, call, and implementation edges', () => {
  const edges = edgeSet(buildScipGraph(scip, FIXTURE));
  // user_service imports + calls UserRepo (two roles, two edges)
  assert.ok(edges.has('py:src/service/user_service.py imports py:src/repository/users.py'));
  assert.ok(edges.has('py:src/service/user_service.py calls py:src/repository/users.py'));
  // user_service implements BaseService -> inherits edge
  assert.ok(edges.has('py:src/service/user_service.py inherits py:src/service/base.py'));
  // routes imports + calls UserService
  assert.ok(edges.has('py:src/api/routes.py imports py:src/service/user_service.py'));
  assert.ok(edges.has('py:src/api/routes.py calls py:src/service/user_service.py'));
});

test('external symbols (no local definition) and local symbols create no edges', () => {
  const g = buildScipGraph(scip, FIXTURE);
  // typing/List# is external, "local 7" is function-local — neither resolves.
  assert.strictEqual(g.metrics.external_imports, 0, 'no ext: edges are emitted');
  assert.ok(!g.edges.some((e) => String(e.target).startsWith('ext:')));
  assert.ok(!g.edges.some((e) => /typing|local/.test(e.target)));
});

test('metrics count internal edges and find no cycle in the acyclic sample', () => {
  const g = buildScipGraph(scip, FIXTURE);
  assert.strictEqual(g.metrics.files, 4);
  assert.strictEqual(g.metrics.edges, 5);
  assert.deepStrictEqual(g.metrics.cycles, []);
});

test('cycle detection works on a mutually-referencing SCIP index (regression for the Set-index no-op)', () => {
  const cyclic = {
    documents: [
      {
        language: 'go', relativePath: 'a.go',
        occurrences: [
          { symbol: 'scip-go go m 1 a/A#', symbolRoles: 1 },
          { symbol: 'scip-go go m 1 b/B#', symbolRoles: 0 },
        ],
        symbols: [{ symbol: 'scip-go go m 1 a/A#', displayName: 'A' }],
      },
      {
        language: 'go', relativePath: 'b.go',
        occurrences: [
          { symbol: 'scip-go go m 1 b/B#', symbolRoles: 1 },
          { symbol: 'scip-go go m 1 a/A#', symbolRoles: 0 },
        ],
        symbols: [{ symbol: 'scip-go go m 1 b/B#', displayName: 'B' }],
      },
    ],
  };
  const g = buildScipGraph(cyclic, 'cyclic.json');
  assert.strictEqual(g.metrics.cycles.length, 1, 'detects the a.go <-> b.go cycle');
  assert.deepStrictEqual(g.metrics.cycles[0].sort(), ['go:a.go', 'go:b.go']);
});

test('displayNameOf falls back to the last symbol descriptor when no displayName', () => {
  assert.strictEqual(displayNameOf({ symbol: 'scip-python python myapp 1.0 src/m/Thing#' }), 'Thing');
  assert.strictEqual(displayNameOf({ displayName: 'Explicit', symbol: 'x' }), 'Explicit');
});
