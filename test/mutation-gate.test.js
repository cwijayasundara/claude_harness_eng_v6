'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'mutation-gate.js'));

test('mutatableFiles keeps production source, drops tests and vendored trees', () => {
  const files = [
    'src/billing.py', 'src/api/handler.ts', 'src/util.js',
    'src/billing_test.py', 'tests/test_billing.py', 'src/api/handler.test.ts',
    'src/__tests__/x.js', 'node_modules/dep/index.js', 'docs/readme.md', 'data.json',
  ];
  assert.deepStrictEqual(
    lib.mutatableFiles(files),
    ['src/billing.py', 'src/api/handler.ts', 'src/util.js']
  );
});

test('groupByLang splits python from js/ts', () => {
  const g = lib.groupByLang(['a.py', 'b.ts', 'c.jsx', 'd.py']);
  assert.deepStrictEqual(g.python, ['a.py', 'd.py']);
  assert.deepStrictEqual(g.js, ['b.ts', 'c.jsx']);
});

test('pickTestCommand discovers python and js commands, null when absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  assert.strictEqual(lib.pickTestCommand('python', dir), null);
  assert.strictEqual(lib.pickTestCommand('js', dir), null);
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
  assert.match(lib.pickTestCommand('python', dir), /pytest/);
  assert.match(lib.pickTestCommand('js', dir), /npm test/);
});

test('interpretResult: pass, fail, no-sites, and dry-run', () => {
  assert.deepStrictEqual(lib.interpretResult(null), { decided: false });
  assert.deepStrictEqual(lib.interpretResult({ dry_run: true }), { decided: false });
  const pass = lib.interpretResult({ pass: true, score: 1, tested: 3, survived: [] });
  assert.strictEqual(pass.decided, true);
  assert.strictEqual(pass.pass, true);
  const fail = lib.interpretResult({ pass: false, score: 0.5, tested: 2, survived: [{ file: 'a.py', line: 4, operator: '>->>=' }] });
  assert.strictEqual(fail.pass, false);
  assert.strictEqual(fail.survived.length, 1);
  const noSites = lib.interpretResult({ pass: true, score: null, tested: 0, survived: [] });
  assert.strictEqual(noSites.pass, true, 'no mutation sites is a pass, not a failure');
});

test('renderSurvivors names the exact site and the flip, LLM-legibly', () => {
  assert.strictEqual(lib.renderSurvivors([]), '');
  const txt = lib.renderSurvivors([{ file: 'src/bill.py', line: 12, operator: '>->>=' }]);
  assert.match(txt, /src\/bill\.py:12/);
  assert.match(txt, /survived/);
});
