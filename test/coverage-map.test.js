const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const indexer = path.join(
  repoRoot, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py'
);
const coverageMap = path.join(
  repoRoot, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'coverage_map.py'
);
const fixture = path.join(__dirname, 'fixtures', 'code-index', 'sample');

// Builds a real coverage.py SQLite file (schema v7: file/context/line_bits with
// numbits bitsets) without needing coverage installed.
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
con.execute('INSERT INTO line_bits VALUES (1, 2, ?)', (numbits([1, 2]),))
con.commit()
`;

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-map-'));
  fs.cpSync(fixture, dir, { recursive: true });
  const out = path.join(dir, 'specs', 'brownfield', 'code-graph.json');
  let res = spawnSync('python3', [indexer, '--root', dir, '--out', out], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const covDb = path.join(dir, '.coverage');
  res = spawnSync('python3', ['-c', BUILD_COVERAGE_DB, covDb, dir], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return { dir, graph: out, covDb };
}

function runMap(graph, coverage, extra = []) {
  const res = spawnSync('python3', [
    coverageMap, '--graph', graph, '--coverage', coverage, ...extra,
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return JSON.parse(res.stdout);
}

function verdictOf(report, symbol) {
  const row = report.results.find((r) => r.symbol === symbol);
  assert.ok(row, `missing verdict for ${symbol}: ${JSON.stringify(report.results.map((r) => r.symbol))}`);
  return row;
}

test('symbols executed by a named test context are COVERED with that test listed', () => {
  const { graph, covDb } = makeProject();
  const report = runMap(graph, covDb);
  assert.strictEqual(report.contexts_available, true);
  const row = verdictOf(report, 'py:db/session.py#get_session');
  assert.strictEqual(row.verdict, 'COVERED');
  assert.deepStrictEqual(row.tests, ['tests/test_session.py::test_get_session']);
  assert.ok(row.start >= 1 && row.end >= row.start);
});

test('symbols touched only at import time (empty context) are UNCOVERED', () => {
  const { graph, covDb } = makeProject();
  const report = runMap(graph, covDb);
  const row = verdictOf(report, 'py:db/session.py#close_session');
  assert.strictEqual(row.verdict, 'UNCOVERED');
  assert.deepStrictEqual(row.tests, []);
});

test('files with no coverage rows are UNCOVERED, including class methods', () => {
  const { graph, covDb } = makeProject();
  const report = runMap(graph, covDb, ['--files', 'api/users.py']);
  assert.strictEqual(verdictOf(report, 'py:api/users.py#save').verdict, 'UNCOVERED');
  const method = verdictOf(report, 'py:api/users.py#UserService.create_user');
  assert.strictEqual(method.verdict, 'UNCOVERED');
  assert.ok(!report.results.some((r) => r.path === 'db/session.py'),
    '--files must filter to the requested files');
});

test('istanbul coverage-final.json gives file-level verdicts for JS/TS symbols', () => {
  const { dir, graph } = makeProject();
  const covJson = path.join(dir, 'coverage-final.json');
  const utilsAbs = path.join(dir, 'src', 'lib', 'utils.ts');
  fs.writeFileSync(covJson, JSON.stringify({
    [utilsAbs]: {
      path: utilsAbs,
      statementMap: { 0: { start: { line: 2 }, end: { line: 2 } } },
      s: { 0: 3 },
    },
  }));
  const report = runMap(graph, covJson, ['--files', 'src/lib/utils.ts', 'src/components/Button.tsx']);
  assert.strictEqual(report.contexts_available, false);
  assert.strictEqual(verdictOf(report, 'ts:src/lib/utils.ts#helper').verdict, 'COVERED');
  assert.strictEqual(verdictOf(report, 'ts:src/components/Button.tsx#Button').verdict, 'UNCOVERED');
});

test('missing coverage data exits 2 with a clear message', () => {
  const { graph } = makeProject();
  const res = spawnSync('python3', [
    coverageMap, '--graph', graph, '--coverage', '/nonexistent/.coverage',
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 2);
  assert.ok(/no coverage data/i.test(res.stderr), res.stderr);
});

test('exits 3 with a loud error when the graph has no symbol records (regex fallback)', () => {
  const { dir, covDb } = makeProject();
  // A regex-fallback graph (build_graph.js) has nodes/edges but no `files`.
  const fallbackGraph = path.join(dir, 'fallback-graph.json');
  fs.writeFileSync(fallbackGraph, JSON.stringify({
    nodes: [{ id: 'src/Main.java', type: 'module' }],
    edges: [],
    meta: { producer: 'regex-fallback', root: dir },
  }));
  const res = spawnSync('python3', [
    coverageMap, '--graph', fallbackGraph, '--coverage', covDb,
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stderr, /no per-file symbol records/);
  assert.match(res.stderr, /UNCOVERED/);
});
