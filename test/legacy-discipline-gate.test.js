'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'legacy-discipline-gate.js');
const { checkLegacyDiscipline, verdictsByFile, hasSymbolRecords, readReceipts, run } = require(SCRIPT);

const COVERED_ROW = { path: 'src/a.py', symbol: '1#foo', start: 1, end: 5, verdict: 'COVERED', tests: ['t'], recordedAt: '2026-01-01T00:00:00Z' };
const UNCOVERED_ROW = { path: 'src/b.py', symbol: '1#bar', start: 1, end: 5, verdict: 'UNCOVERED', tests: [], recordedAt: '2026-01-01T00:00:00Z' };

test('a modified file with a COVERED receipt and no test staged passes', () => {
  const v = checkLegacyDiscipline(['src/a.py'], [COVERED_ROW], ['src/a.py']);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.noVerdict, []);
  assert.deepStrictEqual(v.uncoveredNoEvidence, []);
});

test('a modified file with no receipt at all is blocked (Iron Law never proven)', () => {
  const v = checkLegacyDiscipline(['src/never-checked.py'], [COVERED_ROW], ['src/never-checked.py']);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.noVerdict, ['src/never-checked.py']);
});

test('an UNCOVERED receipt with no test-shaped file staged is blocked', () => {
  const v = checkLegacyDiscipline(['src/b.py'], [UNCOVERED_ROW], ['src/b.py']);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.uncoveredNoEvidence, ['src/b.py']);
});

test('an UNCOVERED receipt WITH a staged test-shaped file passes (pin-down/sprout evidence)', () => {
  const v = checkLegacyDiscipline(['src/b.py'], [UNCOVERED_ROW], ['src/b.py', 'tests/test_b.py']);
  assert.strictEqual(v.pass, true);
});

test('latest-wins: a symbol recorded UNCOVERED then later COVERED reads as COVERED', () => {
  const later = { ...UNCOVERED_ROW, verdict: 'COVERED', tests: ['t'], recordedAt: '2026-01-02T00:00:00Z' };
  const v = checkLegacyDiscipline(['src/b.py'], [UNCOVERED_ROW, later], ['src/b.py']);
  assert.strictEqual(v.pass, true);
});

test('verdictsByFile groups the latest row per symbol under its file', () => {
  const byFile = verdictsByFile([COVERED_ROW, UNCOVERED_ROW]);
  assert.strictEqual(byFile.get('src/a.py').length, 1);
  assert.strictEqual(byFile.get('src/b.py')[0].verdict, 'UNCOVERED');
});

test('no files to check trivially passes', () => {
  const v = checkLegacyDiscipline([], [], []);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.checked, 0);
});

test('hasSymbolRecords is true only for an ast-producer graph with real symbols', () => {
  assert.strictEqual(hasSymbolRecords({ files: [{ path: 'a.py', symbols: [{ name: 'f', start: 1, end: 2 }] }] }), true);
  assert.strictEqual(hasSymbolRecords({ files: [{ path: 'a.py', symbols: [] }] }), false);
  assert.strictEqual(hasSymbolRecords({ files: [] }), false);
  assert.strictEqual(hasSymbolRecords({}), false);
  assert.strictEqual(hasSymbolRecords(null), false);
});

// --- run() CLI (injected root/exec, no subprocess) ----------------------------

function makeProject({ graph, receipts } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-discipline-'));
  if (graph !== null) {
    const p = path.join(dir, 'specs', 'brownfield', 'code-graph.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(graph || { files: [{ path: 'src/a.py', symbols: [{ name: 'f', start: 1, end: 2 }] }] }));
  }
  if (receipts) {
    const p = path.join(dir, 'specs', 'reviews', 'coverage-verdicts.jsonl');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, receipts.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return dir;
}

test('run exits 0 with a no-graph verdict when code-graph.json is absent', () => {
  const dir = makeProject({ graph: null });
  const code = run(['--staged'], dir, { exec: () => '' });
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'legacy-discipline-gate.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-graph');
});

test('run exits 0 with a no-graph verdict when the graph has no per-file symbol records (regex fallback)', () => {
  const dir = makeProject({ graph: { files: [] }, receipts: [] });
  const code = run(['--staged'], dir, { exec: () => '' });
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'legacy-discipline-gate.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-graph');
});

test('run --files blocks a modified source file with no receipt', () => {
  const dir = makeProject({ receipts: [] });
  const code = run(['--files', 'src/a.py'], dir, {});
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'legacy-discipline-gate.json'), 'utf8'));
  assert.deepStrictEqual(verdict.noVerdict, ['src/a.py']);
});

test('run --files passes when the receipt covers the modified file', () => {
  const dir = makeProject({ receipts: [{ path: 'src/a.py', symbol: '1#f', start: 1, end: 2, verdict: 'COVERED', tests: ['t'], recordedAt: 't1' }] });
  const code = run(['--files', 'src/a.py'], dir, {});
  assert.strictEqual(code, 0);
});

test('run --staged uses the injected exec, differentiating diff-filter=M from ACMR', () => {
  const dir = makeProject({ receipts: [] });
  const fakeExec = (cmd, args) => {
    if (args.includes('--diff-filter=M')) return 'src/a.py\n';
    return 'src/a.py\ntests/test_a.py\n'; // ACMR: includes the newly-added pin-down test
  };
  const code = run(['--staged'], dir, { exec: fakeExec });
  // no receipt at all for src/a.py -> still blocked regardless of test evidence
  assert.strictEqual(code, 1);
});

test('run --staged: a covered file with an unrelated staged test still passes', () => {
  const dir = makeProject({ receipts: [{ path: 'src/a.py', symbol: '1#f', start: 1, end: 2, verdict: 'COVERED', tests: ['t'], recordedAt: 't1' }] });
  const fakeExec = (cmd, args) => (args.includes('--diff-filter=M') ? 'src/a.py\n' : 'src/a.py\n');
  const code = run(['--staged'], dir, { exec: fakeExec });
  assert.strictEqual(code, 0);
});

test('run --staged: the modified-file query uses diff-filter=MR exactly (renames are not silently exempt)', () => {
  // Regression for CR-002: a bare `--diff-filter=M` misses git's rename
  // detection (status R for a modified-and-renamed file), which would let a
  // rename+edit dodge the receipt requirement entirely. Assert the EXACT
  // filter value, not a loose substring — `.includes('--diff-filter=M')`
  // also matches `--diff-filter=MR` and would not have caught a regression.
  const dir = makeProject({ receipts: [] });
  const seenFilters = [];
  const fakeExec = (cmd, args) => {
    const filterArg = args.find((a) => a.startsWith('--diff-filter='));
    seenFilters.push(filterArg);
    return '';
  };
  run(['--staged'], dir, { exec: fakeExec });
  assert.ok(seenFilters.includes('--diff-filter=MR'), seenFilters.join(', '));
});

test('readReceipts tolerates a missing file and skips malformed lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-discipline-'));
  assert.deepStrictEqual(readReceipts(dir), []);
  const p = path.join(dir, 'specs', 'reviews', 'coverage-verdicts.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'not json\n' + JSON.stringify(COVERED_ROW) + '\n');
  const rows = readReceipts(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].path, 'src/a.py');
});
