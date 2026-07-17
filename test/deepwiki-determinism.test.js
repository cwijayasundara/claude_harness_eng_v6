'use strict';

// The committed DeepWiki (docs/CODEBASE.md, specs/brownfield/wiki/concepts/*) is
// regenerated after every edit by the graph-refresh hook. It is supposed to be
// deterministic — same code-graph => byte-identical output — but two churn
// sources broke that and produced spurious diffs on every run:
//   1. a wall-clock timestamp embedded in CODEBASE.md and in each concept sidecar
//   2. the CODEBASE.md hub table inherited the graph's array order, so equal-key
//      hubs (same fan_in/fan_out) reshuffled between runs.
// These tests pin the determinism guarantee at the source.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { hubsFromGraph, buildHomepage } = require('../.claude/scripts/human-codebase.js');
const { buildConceptPages } = require('../.claude/scripts/nav-concepts.js');

const ISO_RE = /\d{4}-\d\d-\d\dT\d\d:\d\d/;

test('hubsFromGraph orders equal-key hubs deterministically (by path), independent of input order', () => {
  const hubs = [
    { id: 'js:z/config.js', fan_in: 5, fan_out: 0 },
    { id: 'js:a/helper.js', fan_in: 5, fan_out: 0 },
    { id: 'js:m/mid.js', fan_in: 5, fan_out: 0 },
    { id: 'js:big/hub.js', fan_in: 9, fan_out: 2 },
  ];
  const order = hubsFromGraph({ metrics: { hubs } }).map((h) => h.path);
  assert.deepStrictEqual(order, ['big/hub.js', 'a/helper.js', 'm/mid.js', 'z/config.js']);
  // reversing the input must not change the rendered order
  const rev = hubsFromGraph({ metrics: { hubs: [...hubs].reverse() } }).map((h) => h.path);
  assert.deepStrictEqual(rev, order);
});

function tempProjectWithGraph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-det-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'pkg', 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'core', 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'pkg', 'core', 'b.js'), 'const b = 2;\n');
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({
    files: [
      { path: 'pkg/core/a.js', symbols: [{ name: 'a', kind: 'const' }] },
      { path: 'pkg/core/b.js', symbols: [{ name: 'b', kind: 'const' }] },
    ],
    edges: [{ source: 'js:pkg/core/a.js', target: 'js:pkg/core/b.js', kind: 'imports' }],
    metrics: { hubs: [{ id: 'js:pkg/core/b.js', fan_in: 1, fan_out: 0 }] },
  }));
  return dir;
}

test('CODEBASE.md carries no wall-clock timestamp and is byte-identical across renders', () => {
  const dir = tempProjectWithGraph();
  try {
    const a = buildHomepage({ root: dir }).md;
    const b = buildHomepage({ root: dir }).md;
    assert.ok(!ISO_RE.test(a), 'CODEBASE.md must not embed a wall-clock timestamp');
    assert.strictEqual(a, b, 'same graph must render byte-identical CODEBASE.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('concept sidecars carry no timestamp and are byte-identical on a forced re-render', () => {
  const dir = tempProjectWithGraph();
  try {
    buildConceptPages({ projectDir: dir, force: true });
    const sidecar = path.join(dir, 'specs', 'brownfield', 'wiki', 'concepts', 'pkg__core.meta.json');
    const first = fs.readFileSync(sidecar, 'utf8');
    assert.ok(!ISO_RE.test(first), 'concept sidecar must not embed a wall-clock timestamp');
    buildConceptPages({ projectDir: dir, force: true });
    const second = fs.readFileSync(sidecar, 'utf8');
    assert.strictEqual(first, second, 'forced re-render must be byte-identical');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
