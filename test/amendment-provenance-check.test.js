'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'amendment-provenance-check.js');
const { checkProvenance, run } = require(SCRIPT);

test('a commit touching non-design files is not-applicable', () => {
  const v = checkProvenance(['src/api/users.py', 'docs/a.md'], true);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'not-applicable');
});

test('a design change with no prior baseline is the initial-design commit (exempt)', () => {
  const v = checkProvenance(['specs/design/architecture.md', 'specs/design/api-contracts.schema.json'], false);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'initial-design');
});

test('a design change over an existing baseline with no amendment file fails loudly', () => {
  const v = checkProvenance(['specs/design/architecture.md'], true);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.verdict, 'missing_amendment');
  assert.match(v.reason, /no matching file under specs\/design\/amendments\//);
});

test('a design change paired with a new amendment file in the same commit passes', () => {
  const v = checkProvenance(
    ['specs/design/architecture.md', 'specs/design/amendments/sprint-2.md'],
    true
  );
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'amended');
  assert.deepStrictEqual(v.amendments, ['specs/design/amendments/sprint-2.md']);
});

test('a change only inside specs/design/amendments/ (no other design file touched) is not-applicable', () => {
  const v = checkProvenance(['specs/design/amendments/sprint-2.md'], true);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'not-applicable');
});

// --- run() CLI (injected deps, no subprocess) ---------------------------------

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amendment-provenance-'));
}

test('run --files writes the verdict and exits 1 on a missing amendment', () => {
  const dir = makeProject();
  const code = run(['--files', 'specs/design/architecture.md'], dir, { baselineExists: true });
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'amendment-provenance.json'), 'utf8'));
  assert.strictEqual(verdict.pass, false);
});

test('run --staged uses the injected exec to list staged files', () => {
  const dir = makeProject();
  const fakeExec = () => 'specs/design/architecture.md\nspecs/design/amendments/sprint-2.md\n';
  const code = run(['--staged'], dir, { exec: fakeExec, baselineExists: true });
  assert.strictEqual(code, 0);
});

test('run exits 0 for the initial-design commit', () => {
  const dir = makeProject();
  const code = run(['--files', 'specs/design/architecture.md'], dir, { baselineExists: false });
  assert.strictEqual(code, 0);
});
