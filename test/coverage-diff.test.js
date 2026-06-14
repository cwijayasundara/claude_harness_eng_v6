'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'coverage-diff.js');
const { normalizeCoverage, computeDiffCoverage } = require(SCRIPT);

// The repo-wide ratchet (/auto Gate 3) can rise while a group ships dark code, as
// long as other files carry the average. coverage-diff measures only the files the
// group changed, so new untested code is caught at the diff level.

const ISTANBUL = {
  total: { lines: { total: 100, covered: 90, pct: 90 } },
  '/repo/src/orders.js': { lines: { total: 10, covered: 5, pct: 50 } },
  '/repo/src/users.js': { lines: { total: 10, covered: 10, pct: 100 } },
  '/repo/src/untouched.js': { lines: { total: 80, covered: 75, pct: 93.75 } },
};

const PYCOV = {
  files: {
    'src/orders.py': { summary: { num_statements: 10, covered_lines: 5, percent_covered: 50 } },
    'src/users.py': { summary: { num_statements: 10, covered_lines: 9, percent_covered: 90 } },
  },
};

test('normalizeCoverage reads the Istanbul coverage-summary shape', () => {
  const n = normalizeCoverage(ISTANBUL);
  assert.strictEqual(n['/repo/src/orders.js'].covered, 5);
  assert.strictEqual(n['/repo/src/orders.js'].total, 10);
  assert.ok(!('total' in n), 'the synthetic "total" row is dropped');
});

test('normalizeCoverage reads the Python coverage json shape', () => {
  const n = normalizeCoverage(PYCOV);
  assert.strictEqual(n['src/orders.py'].covered, 5);
  assert.strictEqual(n['src/orders.py'].total, 10);
});

test('computeDiffCoverage aggregates only the changed files, matching abs vs rel paths', () => {
  const r = computeDiffCoverage(normalizeCoverage(ISTANBUL), ['src/orders.js', 'src/users.js']);
  assert.strictEqual(r.covered, 15);
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.pct, 75);
  assert.strictEqual(r.matched, 2, 'untouched.js is excluded');
});

test('computeDiffCoverage returns null pct when no changed file has coverage data', () => {
  const r = computeDiffCoverage(normalizeCoverage(ISTANBUL), ['README.md', 'src/new-and-unmeasured.js']);
  assert.strictEqual(r.pct, null);
  assert.strictEqual(r.matched, 0);
});

// --- CLI ----------------------------------------------------------------------

function write(dir, name, data) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe' }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

test('CLI: exit 0 when per-diff coverage meets the floor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
  const r = run(['--coverage', write(dir, 'c.json', ISTANBUL),
    '--files', 'src/users.js', '--floor', '80']); // users.js = 100%
  assert.strictEqual(r.code, 0);
});

test('CLI: exit 1 when per-diff coverage is below the floor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
  const r = run(['--coverage', write(dir, 'c.json', ISTANBUL),
    '--files', 'src/orders.js', '--floor', '80']); // orders.js = 50%
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /50/);
});

test('CLI: exit 0 when nothing measurable changed (no false block)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
  const r = run(['--coverage', write(dir, 'c.json', ISTANBUL), '--files', 'README.md', '--floor', '80']);
  assert.strictEqual(r.code, 0);
});

test('CLI: appends a coverage-history record with pct, pass and label', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
  const hist = path.join(dir, 'coverage-history.jsonl');
  run(['--coverage', write(dir, 'c.json', ISTANBUL), '--files', 'src/orders.js',
    '--floor', '80', '--history', hist, '--label', 'C', '--stamp', '2026-06-14T00:00:00Z']);
  const line = JSON.parse(fs.readFileSync(hist, 'utf8').trim().split('\n').pop());
  assert.strictEqual(line.label, 'C');
  assert.strictEqual(line.pct, 50);
  assert.strictEqual(line.pass, false);
  assert.strictEqual(line.at, '2026-06-14T00:00:00Z');
});

test('CLI: exit 2 when --coverage is missing', () => {
  const r = run(['--files', 'src/x.js']);
  assert.strictEqual(r.code, 2);
});
