'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const { script, makeProject, midBuildProject } = require('./helpers/pipeline-status-fixtures');

test('CLI status --json emits a parseable snapshot object', () => {
  const res = spawnSync('node', [script, 'status', '--json'], { cwd: midBuildProject(), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const snap = JSON.parse(res.stdout);
  assert.strictEqual(snap.schema_version, 1);
  assert.ok(snap.generated_at, 'generated_at injected at call time');
  assert.strictEqual(snap.features.total, 4);
});

test('CLI status prints a human-readable summary by default', () => {
  const res = spawnSync('node', [script, 'status'], { cwd: midBuildProject(), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Pipeline/i);
  assert.match(res.stdout, /2 \/ 4/);
});

test('CLI rejects an unknown subcommand', () => {
  const res = spawnSync('node', [script, 'frobnicate'], { cwd: makeProject(), encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0, 'unknown command must exit non-zero');
});
