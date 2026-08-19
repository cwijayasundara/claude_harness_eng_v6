'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  causeOf, clusterFailures, clusterNotes, clusterTableLines,
} = require('../.claude/hooks/lib/failure-clusters');

test('causeOf maps known sensors and failure categories, else unknown', () => {
  assert.strictEqual(causeOf({ sensor: 'registry-names' }), 'hallucinated-dep');
  assert.strictEqual(causeOf({ sensor: 'trajectory-contract' }), 'skipped-verification');
  assert.strictEqual(causeOf({ category: 'type_error' }), 'quality');
  assert.strictEqual(causeOf({ sensor: 'nope' }), 'unknown');
});

test('clusterFailures ranks causes and names a dominant class at count >= 2', () => {
  const rows = [
    { sensor: 'live-externals' },
    { sensor: 'test-integrity' },
    { sensor: 'secret-scan' },
  ];
  const c = clusterFailures(rows);
  assert.strictEqual(c.dominant, 'skipped-verification');
  assert.strictEqual(c.clusters['skipped-verification'].count, 2);
  assert.strictEqual(c.window, 3);
});

test('clusterFailures does not name a dominant class on a singleton', () => {
  const c = clusterFailures([{ sensor: 'secret-scan' }]);
  assert.strictEqual(c.dominant, null);
});

test('clusterNotes and table stay quiet on an empty window', () => {
  assert.deepStrictEqual(clusterNotes({ dominant: null, window: 0, clusters: {} }), []);
  assert.deepStrictEqual(
    clusterTableLines({ window: 0, clusters: {} }),
    ['- No clustered failures in the window.']
  );
});

test('clusterNotes names the dominant cause for /retro', () => {
  const notes = clusterNotes(clusterFailures([
    { sensor: 'token-advisor' },
    { sensor: 'context-pack' },
  ]));
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /context-miss/);
  assert.match(notes[0], /before swapping models/);
});
