'use strict';

// Gap G29 Gap B, design goal 3: narrow bite-check backstop for a manual
// commit's UNCOVERED-evidence path. runMutationOnFiles is dependency-injected
// (mirrors hooks/lib/mutation-gate.js's own test style) so this is provable
// without spawning real subprocesses or a real test suite.

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { biteCheckFiles, DEFAULTS } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'legacy-bite-check')
);

test('no files to check -> does not run, trivially passes', () => {
  const fakeRun = () => { throw new Error('must not be called'); };
  const r = biteCheckFiles([], '/proj', fakeRun, {});
  assert.deepStrictEqual(r, { ran: false, pass: true, results: [] });
});

test('runs with the narrow DEFAULTS (few mutants, short timeout), scoped to the given files only', () => {
  let seenFiles = null;
  let seenOpts = null;
  const fakeRun = (files, projectDir, opts) => {
    seenFiles = files;
    seenOpts = opts;
    return { results: [{ lang: 'python', decided: true, pass: true, survived: [] }], blocked: [] };
  };
  const r = biteCheckFiles(['src/b.py'], '/proj', fakeRun, {});
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.pass, true);
  assert.deepStrictEqual(seenFiles, ['src/b.py']);
  assert.strictEqual(seenOpts.maxMutants, DEFAULTS.maxMutants);
  assert.strictEqual(seenOpts.timeoutMs, DEFAULTS.timeoutMs);
});

test('a surviving mutant (the related test does not actually bite) fails the bite-check', () => {
  const fakeRun = () => ({
    results: [{ lang: 'python', decided: true, pass: false, survived: [{ file: 'src/b.py', line: 3, operator: '>->=' }] }],
    blocked: [{ lang: 'python', survived: [{ file: 'src/b.py', line: 3, operator: '>->=' }] }],
  });
  const r = biteCheckFiles(['src/b.py'], '/proj', fakeRun, {});
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.pass, false);
  assert.strictEqual(r.blocked.length, 1);
});

test('a skipped language (no test command discoverable) is surfaced in results, not silently ignored', () => {
  const fakeRun = () => ({ results: [{ lang: 'js', skipped: true, reason: 'no js test command discoverable' }], blocked: [] });
  const r = biteCheckFiles(['src/thing.js'], '/proj', fakeRun, {});
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.results[0].skipped, true);
});

test('caller-supplied opts override the DEFAULTS', () => {
  let seenOpts = null;
  const fakeRun = (files, projectDir, opts) => { seenOpts = opts; return { results: [], blocked: [] }; };
  biteCheckFiles(['src/b.py'], '/proj', fakeRun, { maxMutants: 1, timeoutMs: 5000 });
  assert.strictEqual(seenOpts.maxMutants, 1);
  assert.strictEqual(seenOpts.timeoutMs, 5000);
});
