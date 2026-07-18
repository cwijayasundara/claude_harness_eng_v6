'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { scoutReuse } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'reuse-scout.js')
);

// Minimal code-graph fixture: an upload seam (service + the storage helper it
// delegates to) versus a report seam and the routes file that wires both in.
// upload_service.py has balanced fan-in/fan-out (imported by routes.py, and
// itself imports upload_storage.py) so it lands on scoreSeams's
// recommended_action='introduce-adapter' (a reuse-shaped action) rather than
// 'split' (the routes/report/storage nodes all fall to 'split' since each has
// zero fan-in or fan-out). scoutReuse surfaces reuse-shaped actions first, so
// this makes the upload seam win deterministically and for the right
// structural reason, not just on a raw score tiebreak.
const graph = {
  nodes: [
    { id: 'py:src/services/upload_service.py', kind: 'file', path: 'src/services/upload_service.py', symbols: ['UploadService', 'parse_upload'] },
    { id: 'py:src/services/upload_storage.py', kind: 'file', path: 'src/services/upload_storage.py', symbols: ['UploadStorage'] },
    { id: 'py:src/services/report_service.py', kind: 'file', path: 'src/services/report_service.py', symbols: ['ReportService'] },
    { id: 'py:src/api/routes.py', kind: 'file', path: 'src/api/routes.py', symbols: ['router'] },
  ],
  edges: [
    { source: 'py:src/api/routes.py', target: 'py:src/services/upload_service.py', kind: 'imports' },
    { source: 'py:src/api/routes.py', target: 'py:src/services/report_service.py', kind: 'imports' },
    { source: 'py:src/services/upload_service.py', target: 'py:src/services/upload_storage.py', kind: 'imports' },
  ],
  metrics: { files: 4, edges: 3, cycles: [], hubs: [
    { id: 'py:src/services/upload_service.py', fan_in: 1, fan_out: 1 },
    { id: 'py:src/services/report_service.py', fan_in: 1, fan_out: 0 },
  ] },
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
