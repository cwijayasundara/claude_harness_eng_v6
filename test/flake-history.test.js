'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude/scripts/flake-history.js');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-history-'));
  fs.mkdirSync(path.join(root, 'specs/reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs/drift'), { recursive: true });
  return root;
}

function writeReport(root, flakes) {
  const file = path.join(root, 'specs/reports/flake-report.json');
  fs.writeFileSync(file, JSON.stringify({ runs: 5, completed_runs: 5, errored_runs: 0, flakes }, null, 2));
  return file;
}

function run(root, args = []) {
  return cp.spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
}

test('missing flake report is a no-op', () => {
  const root = tmpProject();
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /no report/);
});

test('appends flake detector result to jsonl history and renders markdown', () => {
  const root = tmpProject();
  writeReport(root, [{ name: 'test A', passed: 3, failed: 2 }]);
  const r = run(root, ['--date', '2026-07-01', '--commit', 'abc123']);
  assert.strictEqual(r.status, 0, r.stderr);
  const jsonl = fs.readFileSync(path.join(root, 'specs/drift/flake-history.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(jsonl.length, 1);
  const row = JSON.parse(jsonl[0]);
  assert.strictEqual(row.name, 'test A');
  assert.strictEqual(row.commit, 'abc123');
  const md = fs.readFileSync(path.join(root, 'specs/drift/flake-history.md'), 'utf8');
  assert.match(md, /test A/);
  assert.match(md, /Occurrences/);
});

test('ranks recurring flakes across runs', () => {
  const root = tmpProject();
  writeReport(root, [{ name: 'test A', passed: 3, failed: 2 }]);
  assert.strictEqual(run(root, ['--date', '2026-07-01']).status, 0);
  writeReport(root, [{ name: 'test A', passed: 2, failed: 3 }, { name: 'test B', passed: 1, failed: 1 }]);
  assert.strictEqual(run(root, ['--date', '2026-07-02']).status, 0);
  const md = fs.readFileSync(path.join(root, 'specs/drift/flake-history.md'), 'utf8');
  assert.ok(md.indexOf('test A') < md.indexOf('test B'), 'test A should rank before test B');
  assert.match(md, /\| test A \| 2 \|/);
});
