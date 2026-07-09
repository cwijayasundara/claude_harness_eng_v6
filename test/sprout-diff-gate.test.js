'use strict';

// Gap G30: mechanical verification of sprouting-instead-of-editing's Iron
// Law ("touch the legacy file at exactly one call line, or the rename pair
// for wrap") for the specific commits legacy-discipline-gate.js (G17/G29)
// already classified as UNCOVERED-with-evidence AND that add a genuinely new
// production file (a sprout, not a pin-down). See that file and
// hooks/lib/{sprout-symbol-check,sprout-classify}.js for the primitives this
// composes rather than reimplements.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { test } = require('node:test');

const gate = require(path.join(__dirname, '..', '.claude', 'scripts', 'sprout-diff-gate'));

const GRAPH = {
  files: [{ path: 'src/legacy.py', symbols: [{ name: 'f', start: 1, end: 5 }, { name: 'g', start: 20, end: 25 }] }],
};

function candidate(file, tier) {
  return { file, tier: tier || 'naming-heuristic', testFiles: [] };
}

test('no candidates at all -> pass, sproutCandidateCount 0, distinguishing note', () => {
  const v = gate.checkSproutDiff([], [], new Map(), GRAPH, null);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.sproutCandidateCount, 0);
  assert.ok(v.note.includes('nothing sprout-shaped'));
});

test('candidate present but no added production file -> pin-down shape, skipped, not blocked', () => {
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], [], new Map(), GRAPH, null);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.sproutCandidateCount, 0);
  assert.deepStrictEqual(v.pinDownSkipped, ['src/legacy.py']);
  assert.ok(v.note.includes('pin-down shape'));
});

test('sprout-shaped, diff touches exactly one symbol -> passes cleanly', () => {
  const ranges = new Map([['src/legacy.py', [[2, 2]]]]);
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], ['src/new_unit.py'], ranges, GRAPH, null);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.sproutCandidateCount, 1);
  assert.strictEqual(v.checked, 1);
  assert.deepStrictEqual(v.cleanPasses, ['src/legacy.py']);
});

test('sprout-shaped, diff touches exactly two symbols (assumed wrap-rename pair) -> passes with a note', () => {
  const ranges = new Map([['src/legacy.py', [[2, 2], [21, 21]]]]);
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], ['src/new_unit.py'], ranges, GRAPH, null);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.assumedWrapPairs.length, 1);
  assert.deepStrictEqual(v.assumedWrapPairs[0].symbols, ['f', 'g']);
});

test('sprout-shaped, diff touches three symbols -> BLOCKS, naming the extras', () => {
  const threeSymbolGraph = {
    files: [{
      path: 'src/legacy.py',
      symbols: [{ name: 'f', start: 1, end: 5 }, { name: 'g', start: 20, end: 25 }, { name: 'h', start: 40, end: 45 }],
    }],
  };
  const ranges = new Map([['src/legacy.py', [[2, 2], [21, 21], [41, 41]]]]);
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], ['src/new_unit.py'], ranges, threeSymbolGraph, null);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.violations.length, 1);
  assert.deepStrictEqual(v.violations[0].symbols, ['f', 'g', 'h']);
});

test('no per-file symbol record for the legacy file -> degrades loudly, does not block', () => {
  const emptyGraph = { files: [] };
  const ranges = new Map([['src/legacy.py', [[2, 2]]]]);
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], ['src/new_unit.py'], ranges, emptyGraph, null);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.noSymbolRecord, ['src/legacy.py']);
});

test('changedRanges === null (unknown, --files mode) -> unverifiable, does not block', () => {
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], ['src/new_unit.py'], null, GRAPH, null);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.unverifiableRanges, ['src/legacy.py']);
});

test('classifySprout fallback note surfaces in classifyNotes', () => {
  const ranges = new Map([['src/legacy.py', [[2, 2]]]]);
  const v = gate.checkSproutDiff([candidate('src/legacy.py')], ['src/new_unit.py'], ranges, GRAPH, null);
  assert.strictEqual(v.classifyNotes.length, 1);
  assert.ok(v.classifyNotes[0].includes('src/legacy.py'));
});

// --- run() / CLI wiring -----------------------------------------------------

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprout-diff-gate-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('run exits 0 with a no-graph verdict when code-graph.json is absent', () => {
  withTempDir((dir) => {
    const code = gate.run(['--staged'], dir);
    assert.strictEqual(code, 0);
    const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'sprout-diff-gate.json'), 'utf8'));
    assert.strictEqual(verdict.verdict, 'no-graph');
  });
});

test('run exits 0 with a no-graph verdict when the graph has no per-file symbol records', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({ files: [] }));
    const code = gate.run(['--staged'], dir);
    assert.strictEqual(code, 0);
  });
});

test('run --files with injected deps: sprout-shaped 3-symbol touch blocks (exit 1)', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
    const threeSymbolGraph = {
      files: [{
        path: 'src/legacy.py',
        symbols: [{ name: 'f', start: 1, end: 5 }, { name: 'g', start: 20, end: 25 }, { name: 'h', start: 40, end: 45 }],
      }],
    };
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify(threeSymbolGraph));
    fs.mkdirSync(path.join(dir, 'specs', 'reviews'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'specs', 'reviews', 'coverage-verdicts.jsonl'),
      `${JSON.stringify({ path: 'src/legacy.py', symbol: '1#f', start: 1, end: 5, verdict: 'UNCOVERED', tests: [], recordedAt: '2026-01-01T00:00:00Z' })}\n`
    );
    const changedRanges = new Map([['src/legacy.py', [[2, 2], [21, 21], [41, 41]]]]);
    const deps = {
      changedRanges,
      allStaged: ['src/legacy.py', 'tests/test_legacy.py', 'src/new_unit.py'],
      addedProdFiles: ['src/new_unit.py'],
      mapText: null,
    };
    const code = gate.run(['--files', 'src/legacy.py', 'tests/test_legacy.py', 'src/new_unit.py'], dir, deps);
    assert.strictEqual(code, 1);
    const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'sprout-diff-gate.json'), 'utf8'));
    assert.strictEqual(verdict.pass, false);
    assert.strictEqual(verdict.violations.length, 1);
  });
});
