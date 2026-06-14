'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'mutation-smoke.js');
const { detectLang, findMutationSites, applyMutationToSource } = require(SCRIPT);

// mutation-smoke generalizes the manual "flip a behavior, confirm the test goes
// red" checkpoint into a bounded, deterministic gate. It mutates code (not
// strings or comments), re-runs the suite per mutant, and reports SURVIVORS —
// mutants no test killed, i.e. behavior nobody actually verifies.
//
// Design contract under test:
//   - false survivors are impossible: never mutate inside a string or comment
//     (a no-op mutation there would survive and falsely fail the gate).
//   - false kills are tolerable: a syntactically-broken mutant fails to run and
//     counts as killed — no signal, but never a false gate failure.

function ops(source, lang) {
  return findMutationSites(source, lang).map((s) => `${s.original}->${s.mutated}`);
}

test('detectLang maps extensions to python / js (or null)', () => {
  assert.strictEqual(detectLang('a/b/calc.py'), 'python');
  assert.strictEqual(detectLang('x.ts'), 'js');
  assert.strictEqual(detectLang('x.tsx'), 'js');
  assert.strictEqual(detectLang('x.mjs'), 'js');
  assert.strictEqual(detectLang('README.md'), null);
});

test('finds relational, logical and boolean-literal sites in JS code', () => {
  const src = 'if (age >= 18 && active === true) return falseValue;';
  const found = ops(src, 'js');
  assert.ok(found.includes('>=->>'), 'relational >= mutated to >');
  assert.ok(found.includes('&&->||'), 'logical && mutated to ||');
  assert.ok(found.includes('===->!=='), 'strict equality mutated');
  assert.ok(found.includes('true->false'), 'boolean literal true mutated');
});

test('never mutates inside a string or a comment (no false survivors)', () => {
  const src = [
    'const msg = "age >= 18 && ok";   // compare age > limit here',
    'return x < y;',
  ].join('\n');
  const sites = findMutationSites(src, 'js');
  // The only real operator is the `<` in `return x < y;`
  assert.deepStrictEqual(sites.map((s) => s.original), ['<']);
});

test('Python: # is a comment, triple-quoted strings are skipped, // is not a comment', () => {
  const src = [
    'x = a >= b  # note: a >= b boundary',
    'doc = """compare p == q inside docstring"""',
    'y = n // 2',           // floor division — not a comment, not a mutated op
    'ok = u and v',
  ].join('\n');
  const found = ops(src, 'python');
  assert.ok(found.includes('>=->>'), 'real >= mutated');
  assert.ok(found.includes('and->or'), 'python logical and mutated');
  assert.ok(!found.some((f) => f.startsWith('==')), 'the == inside the docstring is not a site');
});

test('=> arrow functions are not corrupted into =>=', () => {
  // anonymous arrow inside a call — exercises the => guard
  const src = 'arr.map((a) => a > 0);';
  const sites = findMutationSites(src, 'js');
  assert.deepStrictEqual(sites.map((s) => s.original), ['>'], 'only the real > is a site, not the => arrow');
});

test('>= is recorded once, not also as the > inside it', () => {
  const src = 'return a >= b;';
  const sites = findMutationSites(src, 'js');
  assert.strictEqual(sites.length, 1);
  assert.strictEqual(sites[0].original, '>=');
});

test('applyMutationToSource applies exactly one site, leaving the rest intact', () => {
  const src = 'if (a > b || c < d) {}';
  const sites = findMutationSites(src, 'js');
  const gt = sites.find((s) => s.original === '>');
  const out = applyMutationToSource(src, gt);
  assert.strictEqual(out, 'if (a >= b || c < d) {}');
});

test('sites are returned deterministically sorted by position', () => {
  const src = 'a > b; c < d; e == f;';
  const idx = findMutationSites(src, 'js').map((s) => s.index);
  assert.deepStrictEqual(idx, [...idx].sort((m, n) => m - n));
});

// --- CLI runner ----------------------------------------------------------------

// Fixture sources live as real files under test/fixtures/mutation/ (so the
// function-length hook reads them as code, not as text embedded in a string).
// Each fixture project = a copied source + a plain-node test that exits non-zero
// on wrong behavior. No test framework needed.
const FIX = path.join(__dirname, 'fixtures', 'mutation');

function makeFixture(testBody, srcName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  fs.copyFileSync(path.join(FIX, srcName || 'calc.js'), path.join(dir, 'calc.js'));
  fs.writeFileSync(path.join(dir, 'calc.test.js'), testBody);
  return dir;
}

const STRONG_TEST =
  "const c = require('./calc');\n" +
  "if (c.isAdult(18) !== true || c.isAdult(17) !== false) { process.exit(1); }\n";

test('CLI: a strong test kills the >= -> > mutant (score 1.0, gate passes)', () => {
  const dir = makeFixture(STRONG_TEST);
  const out = path.join(dir, 'report.json');
  execFileSync(process.execPath, [SCRIPT,
    '--files', 'calc.js', '--cwd', dir,
    '--test-cmd', 'node calc.test.js',
    '--out', out], { stdio: 'pipe' });
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(report.tested >= 1, 'at least one mutant tested');
  assert.strictEqual(report.survived.length, 0, 'no survivors');
  assert.strictEqual(report.score, 1);
  assert.strictEqual(report.pass, true);
  // source file restored byte-for-byte after the run
  assert.match(fs.readFileSync(path.join(dir, 'calc.js'), 'utf8'), /age >= 18/);
});

test('CLI: a no-op test lets the mutant survive and fails the gate (exit 1)', () => {
  const dir = makeFixture('process.exit(0);\n'); // test asserts nothing
  const out = path.join(dir, 'report.json');
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT,
      '--files', 'calc.js', '--cwd', dir,
      '--test-cmd', 'node calc.test.js',
      '--threshold', '0.8',
      '--out', out], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(report.survived.length >= 1, 'mutant survived the empty test');
  assert.ok(report.survived[0].file && report.survived[0].line && report.survived[0].operator);
  assert.strictEqual(report.pass, false);
  assert.strictEqual(code, 1, 'gate exits non-zero below threshold');
});

test('CLI: --dry-run lists sites without running the test command (exit 0)', () => {
  const dir = makeFixture('process.exit(1);\n'); // would fail if ever run
  const out = path.join(dir, 'report.json');
  execFileSync(process.execPath, [SCRIPT,
    '--files', 'calc.js', '--cwd', dir, '--dry-run', '--out', out], { stdio: 'pipe' });
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(report.total_sites >= 1);
  assert.strictEqual(report.tested, 0, 'dry-run runs no mutants');
});

test('CLI: --max-mutants bounds how many sites are tested (deterministic sample)', () => {
  // STRONG_TEST requires ./calc's isAdult, which calc-multi.js does not export,
  // so every mutant throws → killed → gate passes (exit 0); we only assert the cap.
  const dir = makeFixture(STRONG_TEST, 'calc-multi.js');
  const out = path.join(dir, 'report.json');
  execFileSync(process.execPath, [SCRIPT,
    '--files', 'calc.js', '--cwd', dir,
    '--test-cmd', 'node calc.test.js', '--max-mutants', '2', '--out', out], { stdio: 'pipe' });
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(report.tested, 2, 'only 2 mutants tested under the cap');
  assert.ok(report.total_sites > 2, 'but more sites existed');
});

test('CLI: no --files is a usage error (exit 2)', () => {
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--test-cmd', 'true'], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});

// --- wiring consistency --------------------------------------------------------

const ROOT = path.join(__dirname, '..');

test('mutation-smoke.md reference exists and states the no-false-survivor principle', () => {
  const p = path.join(ROOT, '.claude', 'skills', 'test', 'references', 'mutation-smoke.md');
  assert.ok(fs.existsSync(p), 'reference present');
  const doc = fs.readFileSync(p, 'utf8').toLowerCase();
  assert.ok(doc.includes('survivor'), 'explains survivors');
  assert.ok(doc.includes('mutation-smoke.js'), 'points at the script');
});

test('pinning-down-behavior generalizes its mutation-smoke checkpoint to the script', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'pinning-down-behavior', 'SKILL.md'), 'utf8');
  assert.match(skill, /mutation-smoke\.js/, 'points the checkpoint at the shared runner');
});
