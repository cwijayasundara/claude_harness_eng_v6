'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { seamConfidence, THRESHOLD } = require('../.claude/scripts/seam-confidence.js');

test('THRESHOLD matches the sprouting cutoff', () => {
  assert.strictEqual(THRESHOLD, 0.5);
});

test('a clean seam (score >= 0.5, extendable) bands high and names the target', () => {
  const r = seamConfidence([
    { path: 'src/api/routes.js', total_score: 0.82, recommended_action: 'extend' },
    { path: 'src/utils/helper.js', total_score: 0.21, recommended_action: 'avoid' },
  ]);
  assert.strictEqual(r.band, 'high');
  assert.strictEqual(r.target_seam, 'src/api/routes.js');
  assert.strictEqual(r.total_score, 0.82);
});

test('best score below threshold bands low', () => {
  const r = seamConfidence([
    { path: 'src/utils/a.js', total_score: 0.3, recommended_action: 'wrap' },
  ]);
  assert.strictEqual(r.band, 'low');
  assert.ok(r.reasons.some((x) => /0\.3/.test(x) && /0\.5/.test(x)));
});

test("best candidate recommending 'avoid' bands low even at a high score", () => {
  const r = seamConfidence([
    { path: 'src/legacy/god.js', total_score: 0.9, recommended_action: 'avoid' },
  ]);
  assert.strictEqual(r.band, 'low');
  assert.ok(r.reasons.some((x) => /avoid/.test(x)));
});

test('no candidates bands low with a no-seam reason', () => {
  const r = seamConfidence([]);
  assert.strictEqual(r.band, 'low');
  assert.strictEqual(r.target_seam, null);
  assert.ok(r.reasons.some((x) => /no seam/i.test(x)));
});
