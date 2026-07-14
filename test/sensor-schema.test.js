'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseDefault, applyDefaults, SCHEMA_VERSION } = require('../.claude/hooks/lib/sensor-schema');

test('parseDefault fills defaults for a bare finding list', () => {
  const r = parseDefault(JSON.stringify({ findings: [{ message: 'x', severity: 'error' }] }));
  assert.strictEqual(r.success, false);         // findings present → not success
  assert.strictEqual(r.score.value, 1);          // default score = finding count
  assert.strictEqual(r.score.direction, 'less');
  assert.strictEqual(r.summary, '1 issue');
  assert.deepStrictEqual(r.metrics, []);
  assert.deepStrictEqual(r.extra, {});
});

test('parseDefault treats empty/absent findings as success', () => {
  const r = parseDefault(JSON.stringify({}));
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.summary, 'No issues');
  assert.strictEqual(r.score.value, 0);
});

test('parseDefault honors explicit success/summary/score', () => {
  const r = parseDefault(JSON.stringify({ success: false, summary: 'coverage 71%', score: { value: 71, direction: 'more', description: 'pct' } }));
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.summary, 'coverage 71%');
  assert.strictEqual(r.score.value, 71);
  assert.strictEqual(r.score.direction, 'more');
});

test('parseDefault tolerates non-JSON stdout (never throws)', () => {
  const r = parseDefault('boom: command not found');
  assert.strictEqual(r.success, false);
  assert.match(r.summary, /boom/);
  assert.strictEqual(r.extra.parseError, true);
});

test('applyDefaults is idempotent and version-stamped', () => {
  const once = applyDefaults({ findings: [] });
  const twice = applyDefaults(once);
  assert.deepStrictEqual(once, twice);
  assert.strictEqual(typeof SCHEMA_VERSION, 'string');
});
