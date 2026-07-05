'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const helper = path.join(
  repoRoot, '.claude', 'skills', 'pe-ic-memo', 'scripts', '_test_build_sample.py'
);

test('build_deck renders a title slide plus one slide per section, with a real table shape on the table section', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ic-memo-'));
  const outPath = path.join(dir, 'sample.pptx');
  const res = spawnSync('python3', [helper, outPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const summary = JSON.parse(res.stdout);

  assert.strictEqual(summary.slide_count, 3); // title + 2 sections
  assert.deepStrictEqual(summary.titles, ['Acme Corp', 'Executive Summary', 'Financial Analysis']);
  assert.strictEqual(summary.table_dims_by_slide[0], null);
  assert.strictEqual(summary.table_dims_by_slide[1], null);
  assert.deepStrictEqual(summary.table_dims_by_slide[2], { rows: 3, cols: 3 });
});

test('build_deck creates the output directory if it does not exist yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ic-memo-'));
  const outPath = path.join(dir, 'nested', 'deeper', 'sample.pptx');
  const res = spawnSync('python3', [helper, outPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(outPath));
});
