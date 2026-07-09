'use strict';

// extractPlaywrightResults (gap G28): the additive, all-specs counterpart to
// gap G15's extractPlaywrightFailures. Split into its own file (rather than
// growing regression-gate.test.js past the 300-line cap) since it covers one
// function with one responsibility: report every spec's {file, line, title,
// ok}, pass or fail, so flake-detector.js's --e2e mode can tell "passed in
// run A, failed in run B" apart.

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const { extractPlaywrightFailures, extractPlaywrightResults } = require(
  path.join(ROOT, '.claude', 'hooks', 'lib', 'regression-gate.js'),
);

// Same fixture regression-gate.test.js uses for extractPlaywrightFailures —
// captured verbatim (trimmed) from a live `playwright test --reporter=json`
// run: one flat spec file, one with a nested describe block.
function twoFileReport() {
  return {
    suites: [
      {
        title: 'sample.spec.js',
        file: 'sample.spec.js',
        specs: [
          { title: 'passing test', ok: true, file: 'sample.spec.js', line: 2 },
          { title: 'failing test', ok: false, file: 'sample.spec.js', line: 5 },
        ],
      },
      {
        title: 'nested.spec.js',
        file: 'nested.spec.js',
        specs: [],
        suites: [
          {
            title: 'group',
            file: 'nested.spec.js',
            specs: [
              { title: 'nested passing', ok: true, file: 'nested.spec.js', line: 3 },
              { title: 'nested failing', ok: false, file: 'nested.spec.js', line: 4 },
            ],
          },
        ],
      },
    ],
  };
}

test('extractPlaywrightResults: returns every spec (pass and fail), with its ok flag', () => {
  const results = extractPlaywrightResults(twoFileReport());
  assert.strictEqual(results.length, 4);
  assert.deepStrictEqual(results[0], { file: 'sample.spec.js', line: 2, title: 'passing test', ok: true });
  assert.deepStrictEqual(results[1], { file: 'sample.spec.js', line: 5, title: 'failing test', ok: false });
  assert.deepStrictEqual(results[2], { file: 'nested.spec.js', line: 3, title: 'group > nested passing', ok: true });
  assert.deepStrictEqual(results[3], { file: 'nested.spec.js', line: 4, title: 'group > nested failing', ok: false });
});

test('extractPlaywrightResults: refactor leaves extractPlaywrightFailures output unchanged', () => {
  const report = twoFileReport();
  const failures = extractPlaywrightFailures(report);
  assert.strictEqual(failures.length, 2);
  assert.deepStrictEqual(failures[0], { file: 'sample.spec.js', line: 5, title: 'failing test' });
  assert.deepStrictEqual(failures[1], { file: 'nested.spec.js', line: 4, title: 'group > nested failing' });
});

test('extractPlaywrightResults: empty report yields empty list', () => {
  assert.deepStrictEqual(extractPlaywrightResults({ suites: [] }), []);
  assert.deepStrictEqual(extractPlaywrightResults(null), []);
});
