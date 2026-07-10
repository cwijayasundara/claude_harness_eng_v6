'use strict';

// Design freeze for packaging vocabulary (Phase 0). Packaging emit is later;
// this only locks the SKU and tier names so implementers share one contract.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'product-skus-and-tiers.md');

test('docs/product-skus-and-tiers.md exists', () => {
  assert.ok(fs.existsSync(DOC), 'product SKU/tier design doc must exist');
});

test('doc names the three product SKUs and symphony boundary', () => {
  const md = fs.readFileSync(DOC, 'utf8');
  assert.match(md, /harness-lite/);
  assert.match(md, /harness-core/);
  assert.match(md, /harness-full/);
  assert.match(md, /symphony/i);
});

test('doc names the three sensor tiers', () => {
  const md = fs.readFileSync(DOC, 'utf8');
  assert.match(md, /\bminimal\b/);
  assert.match(md, /\bstandard\b/);
  assert.match(md, /\bstrict\b/);
  assert.match(md, /quality\.sensor_tier|sensor_tier/);
});

test('doc states standard preserves today\'s pre-commit set', () => {
  const md = fs.readFileSync(DOC, 'utf8');
  assert.match(md, /standard.*pre-commit|pre-commit.*standard/i);
  assert.match(md, /sprout-diff/);
});

test('HARNESS.md and sensor-arbitration reference the dial', () => {
  const harness = fs.readFileSync(path.join(ROOT, 'HARNESS.md'), 'utf8');
  const arbitration = fs.readFileSync(path.join(ROOT, 'docs', 'sensor-arbitration.md'), 'utf8');
  assert.match(harness, /sensor_tier/);
  assert.match(arbitration, /sensor_tier|sensor tier/i);
  assert.match(arbitration, /product-skus-and-tiers/);
});
