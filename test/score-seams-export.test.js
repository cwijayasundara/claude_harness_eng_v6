'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { scoreSeams } = require('../.claude/skills/seam-finder/scripts/score_seams.js');

const GRAPH = {
  nodes: [
    { id: 'n1', path: 'src/api/routes.js', symbols: ['handleRequest'] },
    { id: 'n2', path: 'src/utils/helper.js', symbols: ['fmt'] },
  ],
  edges: [{ source: 'n2', target: 'n1', evidence: 'import' }],
  metrics: { cycles: [] },
};

test('scoreSeams is exported and returns scored candidates', () => {
  const candidates = scoreSeams(GRAPH, 'request handling', {});
  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.length >= 1);
  for (const c of candidates) {
    assert.strictEqual(typeof c.path, 'string');
    assert.strictEqual(typeof c.total_score, 'number');
    assert.strictEqual(typeof c.recommended_action, 'string');
  }
});
