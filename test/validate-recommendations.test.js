'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { validate, validateAll } = require(
  path.resolve(__dirname, '..', '.claude', 'scripts', 'validate-recommendations.js'),
);

function rec(overrides) {
  return {
    id: 'REC-20260713-001',
    target: 'sensor:loop-health',
    change: 'Tighten the tool-error-rate attention line from 10% to 5%.',
    class: 'sensor-tune',
    risk: 'low',
    cost: 'low',
    benefit: 'med',
    confidence: 0.7,
    evidence: ['specs/retro/loop-health.md#observations'],
    status: 'proposed',
    ...overrides,
  };
}

test('validate: accepts a well-formed low-risk recommendation', () => {
  const { errors } = validate(rec());
  assert.deepStrictEqual(errors, []);
});

test('validate: rejects missing required fields', () => {
  const { errors } = validate({ id: 'REC-1' });
  assert.ok(errors.some((e) => /target/.test(e)));
  assert.ok(errors.some((e) => /change/.test(e)));
  assert.ok(errors.some((e) => /class/.test(e)));
});

test('validate: rejects an invalid class / risk / cost / benefit / status', () => {
  const { errors } = validate(rec({ class: 'rewrite-everything', risk: 'extreme', cost: 'x', benefit: 'y', status: 'done' }));
  assert.ok(errors.some((e) => /class/.test(e)));
  assert.ok(errors.some((e) => /risk/.test(e)));
  assert.ok(errors.some((e) => /cost/.test(e)));
  assert.ok(errors.some((e) => /benefit/.test(e)));
  assert.ok(errors.some((e) => /status/.test(e)));
});

test('validate: confidence must be a number in [0,1]', () => {
  assert.ok(validate(rec({ confidence: 1.5 })).errors.some((e) => /confidence/.test(e)));
  assert.ok(validate(rec({ confidence: -0.1 })).errors.some((e) => /confidence/.test(e)));
  assert.ok(validate(rec({ confidence: 'high' })).errors.some((e) => /confidence/.test(e)));
  assert.deepStrictEqual(validate(rec({ confidence: 0 })).errors, []);
  assert.deepStrictEqual(validate(rec({ confidence: 1 })).errors, []);
});

test('validate: evidence must be a non-empty array of non-empty strings', () => {
  assert.ok(validate(rec({ evidence: [] })).errors.some((e) => /evidence/.test(e)));
  assert.ok(validate(rec({ evidence: ['ok', ''] })).errors.some((e) => /evidence/.test(e)));
  assert.ok(validate(rec({ evidence: 'not-an-array' })).errors.some((e) => /evidence/.test(e)));
});

// --- the permanently-human-gated invariant (design doc §4.5) --------------

test('validate: gate-loosen class must declare human_gate:true', () => {
  const missing = validate(rec({ class: 'gate-loosen', human_gate: undefined }));
  assert.ok(missing.errors.some((e) => /human_gate/.test(e)));
  const wrong = validate(rec({ class: 'gate-loosen', human_gate: false }));
  assert.ok(wrong.errors.some((e) => /human_gate/.test(e)));
  const ok = validate(rec({ class: 'gate-loosen', human_gate: true }));
  assert.deepStrictEqual(ok.errors, []);
});

test('validate: security class must declare human_gate:true', () => {
  const missing = validate(rec({ class: 'security', human_gate: undefined }));
  assert.ok(missing.errors.some((e) => /human_gate/.test(e)));
  const ok = validate(rec({ class: 'security', human_gate: true }));
  assert.deepStrictEqual(ok.errors, []);
});

test('validate: low-risk classes do not require human_gate', () => {
  const { errors } = validate(rec({ class: 'docs' }));
  assert.deepStrictEqual(errors, []);
});

// --- validateAll: duplicate-id detection across a batch -------------------

test('validateAll: flags duplicate ids across the batch', () => {
  const { errors } = validateAll([rec(), rec()]);
  assert.ok(errors.some((e) => /duplicate id/.test(e)));
});

test('validateAll: empty batch is valid (no recommendations this run is a legitimate outcome)', () => {
  const { errors, counts } = validateAll([]);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(counts.total, 0);
});

test('validateAll: aggregates per-entry errors with index context', () => {
  const { errors } = validateAll([rec(), { id: 'bad' }]);
  assert.ok(errors.some((e) => /\[1\]/.test(e)));
});
