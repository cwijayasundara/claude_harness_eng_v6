const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { renderCouplingReport } = require(path.join(
  __dirname, '..', '.claude', 'skills', 'code-map', 'scripts', 'render.js'
));

const graph = {
  nodes: [
    { id: 'py:a.py', path: 'a.py' },
    { id: 'py:b.py', path: 'b.py' },
    { id: 'py:orphan.py', path: 'orphan.py' },
  ],
  edges: [
    { source: 'py:a.py', target: 'py:b.py', kind: 'imports' },
    { source: 'py:a.py', target: 'ext:os', kind: 'imports' },
  ],
  metrics: {
    files: 3, edges: 1, external_imports: 1, cycles: [],
    hubs: [{ id: 'py:b.py', fan_in: 1, fan_out: 0, instability: 0 }],
  },
};

test('coupling report lists files with no inbound edges as dead-code candidates', () => {
  const md = renderCouplingReport(graph);
  const section = md.split(/## Dead-code candidates[^\n]*\n/)[1];
  assert.ok(section, 'dead-code section missing');
  assert.ok(section.includes('orphan.py'), 'orphan file not listed');
  assert.ok(!section.includes('`b.py`'), 'imported file wrongly listed as orphan');
});
