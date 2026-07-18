'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { scoutReuse } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'reuse-scout.js')
);

// Minimal code-graph fixture: an upload service used by two call sites.
// upload_service.py has fan_in=2/fan_out=0 (imported by handler_a.py and
// handler_b.py), giving it the highest total_score in the graph (observable
// 0.6 'services' + funnel=1.0 + asymmetry=1.0, x1.5 goal-relevance bump for
// matching "upload" = 1.26) even though scoreSeams's recommendAction labels
// it 'split' (asymmetry>=0.8 with fan_out===0) rather than a reuse-shaped
// action. This is deliberate: it proves scoutReuse ranks by real score, not
// by recommended_action (see the ranking-bug locking test below).
const graph = {
  nodes: [
    { id: 'py:src/services/upload_service.py', kind: 'file', path: 'src/services/upload_service.py', symbols: ['UploadService', 'parse_upload'] },
    { id: 'py:src/api/handler_a.py', kind: 'file', path: 'src/api/handler_a.py', symbols: ['handler_a'] },
    { id: 'py:src/api/handler_b.py', kind: 'file', path: 'src/api/handler_b.py', symbols: ['handler_b'] },
  ],
  edges: [
    { source: 'py:src/api/handler_a.py', target: 'py:src/services/upload_service.py', kind: 'imports' },
    { source: 'py:src/api/handler_b.py', target: 'py:src/services/upload_service.py', kind: 'imports' },
  ],
  metrics: { files: 3, edges: 2, cycles: [] },
};

test('scoutReuse ranks the goal-matching seam first and fires on a real candidate', () => {
  const r = scoutReuse({ graph, goal: 'add a new upload source variant' });
  assert.ok(r.candidates.length >= 1);
  assert.match(r.candidates[0].path, /upload_service/, 'the upload seam ranks first for an upload goal');
  assert.ok(['high', 'medium', 'low'].includes(r.band));
  assert.strictEqual(typeof r.fire, 'boolean');
});

test('scoutReuse fires when an invariant is touched even on a weak seam match', () => {
  const invariantsText = '## Invariants\n\n- All uploads must go through the shared upload pipeline.\n';
  const r = scoutReuse({ graph, goal: 'upload pipeline change', invariantsText });
  assert.ok(r.touched_invariants.length >= 1, 'the upload invariant is flagged as touched');
  assert.strictEqual(r.fire, true);
});

test('scoutReuse degrades to a well-formed low result on an empty graph', () => {
  const r = scoutReuse({ graph: { nodes: [], edges: [], metrics: {} }, goal: 'anything' });
  assert.strictEqual(r.band, 'low');
  assert.strictEqual(r.target_seam, null);
  assert.ok(Array.isArray(r.candidates));
  assert.ok(r.reasons.length >= 1);
});

test('scoutReuse clusters intra-batch stories that share goal terms', () => {
  const r = scoutReuse({
    graph, goal: 'batch',
    batch: [
      { id: 'S1', goal: 'parse currency amount from invoice' },
      { id: 'S2', goal: 'parse currency amount from receipt' },
      { id: 'S3', goal: 'render dashboard chart' },
    ],
  });
  const cluster = r.intra_batch.find((c) => c.stories.includes('S1') && c.stories.includes('S2'));
  assert.ok(cluster, 'S1 and S2 (both currency-amount parsing) cluster together');
  assert.ok(!r.intra_batch.some((c) => c.stories.includes('S3') && c.stories.length > 1), 'S3 does not join');
});

// Fixture where recommendAction's classification diverges from total_score
// ranking, per score_seams.js:
//  - upload_service.py: fan_in=2 (imported by handler_a and handler_b),
//    fan_out=0 -> asymmetry=1.0 with fan_out===0 -> recommendAction returns
//    'split' (NOT in the reuse-shaped set), despite scoring highest
//    (observable=0.6 'services' + funnel=1.0 + asymmetry=1.0, x1.5 goal bump
//    for matching "upload" = 1.26 total_score).
//  - handler_a.py / handler_b.py: fan_out=1, fan_in=0 -> asymmetry=1.0 with
//    fan_in===0 -> also 'split' (total_score=0.8 each, no goal-term match).
//  - orphan_helper.py: no edges at all -> asymmetry=0, funnel=0,
//    observable=0.4 (unclassified 'module' default) -> falls through every
//    recommendAction branch to the default 'wrap' (a reuse-shaped action),
//    despite being the lowest-scoring node (total_score=0.16).
// A sort that prioritizes reuse-shaped recommended_action over total_score
// puts this disconnected, low-value orphan ahead of the real, high-scoring,
// goal-matching seam.
const splitVsWrapGraph = {
  nodes: [
    { id: 'py:src/services/upload_service.py', kind: 'file', path: 'src/services/upload_service.py', symbols: ['UploadService'] },
    { id: 'py:src/api/handler_a.py', kind: 'file', path: 'src/api/handler_a.py', symbols: ['handler_a'] },
    { id: 'py:src/api/handler_b.py', kind: 'file', path: 'src/api/handler_b.py', symbols: ['handler_b'] },
    { id: 'py:src/misc/orphan_helper.py', kind: 'file', path: 'src/misc/orphan_helper.py', symbols: ['orphan_helper'] },
  ],
  edges: [
    { source: 'py:src/api/handler_a.py', target: 'py:src/services/upload_service.py', kind: 'imports' },
    { source: 'py:src/api/handler_b.py', target: 'py:src/services/upload_service.py', kind: 'imports' },
  ],
  metrics: { files: 4, edges: 2, cycles: [] },
};

test('scoutReuse ranks by total_score first, using reuse-shaped action only as a tiebreak', () => {
  const r = scoutReuse({ graph: splitVsWrapGraph, goal: 'add upload source variant' });
  assert.match(
    r.candidates[0].path, /upload_service/,
    'the highest-scoring, goal-matching seam wins even though recommendAction classifies it "split" (not reuse-shaped)'
  );
  assert.strictEqual(r.candidates[0].recommended_action, 'split');
  assert.strictEqual(
    r.band, 'high',
    'band must reflect the winning candidate\'s high score, not be dragged down by a low-score reuse-shaped orphan'
  );
  const orphan = r.candidates.find((c) => /orphan_helper/.test(c.path));
  assert.ok(orphan, 'the low-score orphan is still surfaced among the candidates');
  assert.strictEqual(orphan.recommended_action, 'wrap', 'the orphan\'s action is reuse-shaped');
  assert.ok(
    orphan.total_score < r.candidates[0].total_score,
    'the reuse-shaped orphan scores lower than the winning split-classified seam'
  );
});

test('scoutReuse does not throw on a malformed batch entry', () => {
  assert.doesNotThrow(() => {
    const r = scoutReuse({ graph, goal: 'x', batch: [null] });
    assert.ok(Array.isArray(r.intra_batch));
  });
});
