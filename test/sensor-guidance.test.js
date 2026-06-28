'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { GUIDANCE, rulesInOutput, enrich } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'sensor-guidance.js')
);

test('rulesInOutput finds rule ids in real-ish ruff output', () => {
  const out = 'app/db.py:3:1: F401 `os` imported but unused\napp/db.py:9:80: E501 line too long';
  assert.deepStrictEqual(rulesInOutput(out).sort(), ['E501', 'F401']);
});

test('rulesInOutput finds a namespaced eslint rule', () => {
  const out = "  12:5  warning  Unexpected any  @typescript-eslint/no-explicit-any";
  assert.ok(rulesInOutput(out).includes('@typescript-eslint/no-explicit-any'));
});

test('max-lines does not falsely fire inside max-lines-per-function', () => {
  const out = '  1:1  error  Function has too many lines  max-lines-per-function';
  const hits = rulesInOutput(out);
  assert.ok(hits.includes('max-lines-per-function'));
  assert.ok(!hits.includes('max-lines'), 'whole-token match must exclude the prefix rule');
});

test('enrich appends one coaching line per matched rule', () => {
  const out = 'x.ts:1:1 error no-unused-vars';
  const text = enrich(out);
  assert.match(text, /Self-correction guidance/);
  assert.match(text, /no-unused-vars: Remove the binding/);
});

test('enrich carries the threshold-bump-with-justification valve', () => {
  assert.match(enrich('C901 too complex'), /review focal point/);
  assert.match(enrich('complexity'), /raise the rule threshold/);
});

test('enrich on clean output is empty (no noise when nothing matched)', () => {
  assert.strictEqual(enrich('All checks passed!'), '');
  assert.strictEqual(enrich(''), '');
});

test('every guidance entry is a non-empty string', () => {
  for (const [rule, text] of Object.entries(GUIDANCE)) {
    assert.ok(typeof text === 'string' && text.length > 10, `guidance for ${rule} too thin`);
  }
});
