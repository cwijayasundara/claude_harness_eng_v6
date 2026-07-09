'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'record-coverage-verdict.js');
const { receiptRows, run } = require(SCRIPT);

const REPORT = {
  contexts_available: true,
  results: [
    { symbol: '1#foo', path: 'src/a.py', start: 10, end: 20, verdict: 'COVERED', tests: ['test_a'] },
    { symbol: '1#bar', path: 'src/a.py', start: 22, end: 30, verdict: 'UNCOVERED', tests: [] },
  ],
};

test('receiptRows maps every result to a timestamped receipt row', () => {
  const rows = receiptRows(REPORT, '2026-07-09T00:00:00.000Z');
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], {
    path: 'src/a.py', symbol: '1#foo', start: 10, end: 20, verdict: 'COVERED', tests: ['test_a'],
    recordedAt: '2026-07-09T00:00:00.000Z',
  });
  assert.strictEqual(rows[1].verdict, 'UNCOVERED');
});

test('receiptRows tolerates a missing/malformed report', () => {
  assert.deepStrictEqual(receiptRows(null, 'x'), []);
  assert.deepStrictEqual(receiptRows({}, 'x'), []);
});

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'record-verdict-'));
}

test('run echoes stdin unchanged to stdout and appends receipts', () => {
  const root = tmpRoot();
  const raw = JSON.stringify(REPORT);
  let written = '';
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written += chunk; return true; };
  try {
    run(['--root', root], { readStdin: () => raw, now: () => '2026-07-09T01:00:00.000Z' });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.strictEqual(written, raw, 'stdin must be echoed byte-for-byte');

  const out = fs.readFileSync(path.join(root, 'specs', 'reviews', 'coverage-verdicts.jsonl'), 'utf8');
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].path, 'src/a.py');
  assert.strictEqual(lines[0].recordedAt, '2026-07-09T01:00:00.000Z');
});

test('run appends across multiple invocations (a growing ledger, not an overwrite)', () => {
  const root = tmpRoot();
  const silence = () => {};
  const origWrite = process.stdout.write;
  process.stdout.write = silence;
  try {
    run(['--root', root], { readStdin: () => JSON.stringify(REPORT), now: () => 't1' });
    run(['--root', root], { readStdin: () => JSON.stringify(REPORT), now: () => 't2' });
  } finally {
    process.stdout.write = origWrite;
  }
  const out = fs.readFileSync(path.join(root, 'specs', 'reviews', 'coverage-verdicts.jsonl'), 'utf8');
  assert.strictEqual(out.trim().split('\n').length, 4);
});

test('run tolerates invalid JSON on stdin: passes through, records nothing, exits 0', () => {
  const root = tmpRoot();
  let written = '';
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written += chunk; return true; };
  let code;
  try {
    code = run(['--root', root], { readStdin: () => 'not json', now: () => 't1' });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.strictEqual(code, 0);
  assert.strictEqual(written, 'not json');
  assert.ok(!fs.existsSync(path.join(root, 'specs', 'reviews', 'coverage-verdicts.jsonl')));
});

test('run tolerates empty stdin without creating the receipts file', () => {
  const root = tmpRoot();
  const origWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    run(['--root', root], { readStdin: () => '', now: () => 't1' });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.ok(!fs.existsSync(path.join(root, 'specs', 'reviews', 'coverage-verdicts.jsonl')));
});

// ---------------------------------------------------------------------------
// Real round-trip (CR-005 from the G17 review): coverage_map.py's actual
// stdout, piped through the actual CLI as a real subprocess, must record a
// receipt whose `path` matches a repo-relative POSIX path — the same shape
// `git diff --cached --name-only` reports and legacy-discipline-gate.js
// matches against. A hand-built fixture (as the rest of this file uses) can't
// catch a real format mismatch in that seam.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '..');
const INDEXER = path.join(REPO_ROOT, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py');
const COVERAGE_MAP = path.join(REPO_ROOT, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'coverage_map.py');
const FIXTURE = path.join(__dirname, 'fixtures', 'code-index', 'sample');

const BUILD_COVERAGE_DB = `
import sqlite3, sys
db, root = sys.argv[1], sys.argv[2]
def numbits(lines):
    size = max(lines) // 8 + 1
    b = bytearray(size)
    for n in lines:
        b[n // 8] |= 1 << (n % 8)
    return bytes(b)
con = sqlite3.connect(db)
con.executescript('''
CREATE TABLE coverage_schema (version integer);
CREATE TABLE meta (key text, value text, unique(key));
CREATE TABLE file (id integer primary key, path text, unique(path));
CREATE TABLE context (id integer primary key, context text, unique(context));
CREATE TABLE line_bits (file_id integer, context_id integer, numbits blob,
                        unique(file_id, context_id));
''')
con.execute('INSERT INTO coverage_schema VALUES (7)')
con.execute("INSERT INTO meta VALUES ('has_lines', 'True')")
con.execute("INSERT INTO file (id, path) VALUES (1, ?)", (root + '/db/session.py',))
con.execute("INSERT INTO context (id, context) VALUES (1, '')")
con.execute("INSERT INTO context (id, context) VALUES (2, 'tests/test_session.py::test_get_session')")
con.execute('INSERT INTO line_bits VALUES (1, 1, ?)', (numbits([1, 5]),))
con.commit()
`;

test('real round-trip: coverage_map.py -> record-coverage-verdict.js CLI -> a path git diff would recognize', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-verdict-roundtrip-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const graphPath = path.join(dir, 'specs', 'brownfield', 'code-graph.json');
  let res = spawnSync('python3', [INDEXER, '--root', dir, '--out', graphPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const covDb = path.join(dir, '.coverage');
  res = spawnSync('python3', ['-c', BUILD_COVERAGE_DB, covDb, dir], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);

  const mapRes = spawnSync('python3', [COVERAGE_MAP, '--graph', graphPath, '--coverage', covDb], { encoding: 'utf8' });
  assert.strictEqual(mapRes.status, 0, mapRes.stdout + mapRes.stderr);

  execFileSync(process.execPath, [SCRIPT, '--root', dir], { input: mapRes.stdout, encoding: 'utf8' });

  const receiptsPath = path.join(dir, 'specs', 'reviews', 'coverage-verdicts.jsonl');
  const rows = fs.readFileSync(receiptsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.length > 0, 'expected at least one receipt row');
  for (const row of rows) {
    assert.ok(!path.isAbsolute(row.path), `receipt path must be repo-relative, got: ${row.path}`);
    assert.ok(!row.path.startsWith('./'), `receipt path must not carry a leading ./, got: ${row.path}`);
    assert.strictEqual(row.path, row.path.split(path.sep).join('/'), `receipt path must be POSIX-separated, got: ${row.path}`);
  }
  assert.ok(rows.some((r) => r.path === 'db/session.py'), rows.map((r) => r.path).join(', '));
});
