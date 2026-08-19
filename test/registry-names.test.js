'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  jsPackageName, extractJsSpecs, extractPyModules,
  namesFromPackageJson, namesFromRequirements,
  isBuiltin, editDistance, typosquatOf, classifyCandidate,
  collectNewNames, evaluateNames,
} = require('../.claude/hooks/lib/registry-names');

test('jsPackageName strips subpaths and skips relatives / node: builtins', () => {
  assert.strictEqual(jsPackageName('lodash/fp'), 'lodash');
  assert.strictEqual(jsPackageName('@scope/pkg/sub'), '@scope/pkg');
  assert.strictEqual(jsPackageName('./local'), null);
  assert.strictEqual(jsPackageName('node:fs'), null);
});

test('extractJsSpecs and extractPyModules pull package roots', () => {
  const js = "const x = require('axios');\nimport y from 'lodash/fp';\nimport('vue');\n";
  assert.deepStrictEqual(extractJsSpecs(js).sort(), ['axios', 'lodash', 'vue']);
  const py = 'import requests\nfrom numpy.linalg import inv\n';
  assert.deepStrictEqual(extractPyModules(py).sort(), ['numpy', 'requests']);
});

test('namesFromPackageJson / requirements ignore comments and pins', () => {
  const pkg = namesFromPackageJson({
    dependencies: { react: '18' },
    devDependencies: { eslint: '9' },
  });
  assert.ok(pkg.has('react') && pkg.has('eslint'));
  const req = namesFromRequirements('# c\nrequests>=2\n-r other.txt\n');
  assert.deepStrictEqual([...req], ['requests']);
});

test('isBuiltin covers node builtins and a python stdlib core', () => {
  assert.strictEqual(isBuiltin('fs', 'npm'), true);
  assert.strictEqual(isBuiltin('json', 'pypi'), true);
  assert.strictEqual(isBuiltin('axios', 'npm'), false);
});

test('editDistance and typosquatOf catch 1-edit slopsquats, not the popular name', () => {
  assert.strictEqual(editDistance('requests', 'reqeusts'), 2);
  assert.strictEqual(typosquatOf('reqeusts', 'pypi'), 'requests');
  assert.strictEqual(typosquatOf('lodahs', 'npm'), 'lodash');
  assert.strictEqual(typosquatOf('lodash', 'npm'), null);
  assert.strictEqual(typosquatOf('axios', 'npm'), null);
});

test('classifyCandidate prefers typosquat over registry existence', () => {
  const lookup = () => 'exists';
  const hit = classifyCandidate({ name: 'lodahs', ecosystem: 'npm' }, lookup);
  assert.strictEqual(hit.kind, 'typosquat');
  assert.strictEqual(hit.near, 'lodash');
});

test('classifyCandidate flags a missing registry name as hallucinated', () => {
  const lookup = () => 'missing';
  const hit = classifyCandidate({ name: 'totally-not-a-real-pkg-zz', ecosystem: 'npm' }, lookup);
  assert.strictEqual(hit.kind, 'hallucinated');
});

test('collectNewNames reports staged manifest adds and undeclared imports', () => {
  const files = [
    { file: 'package.json', content: JSON.stringify({ dependencies: { axios: '1', lodahs: '1' } }) },
    { file: 'src/a.js', content: "import x from 'made-up-pkg-zz';\nimport y from 'axios';\n" },
  ];
  const names = collectNewNames({
    files,
    headDeclared: ['axios'],
    headLocked: ['axios'],
  }).map((c) => c.name).sort();
  assert.deepStrictEqual(names, ['lodahs', 'made-up-pkg-zz']);
});

test('collectNewNames ignores import fixtures inside test files', () => {
  const names = collectNewNames({
    files: [
      { file: 'test/registry-names.test.js', content: "import x from 'made-up-pkg-zz';\n" },
    ],
    headDeclared: ['axios'],
    headLocked: ['axios'],
  });
  assert.deepStrictEqual(names, []);
});

test('evaluateNames blocks typosquat and hallucinated, fail-opens lookup errors', () => {
  const lookup = (eco, name) => {
    if (name === 'made-up-pkg-zz') return 'missing';
    if (name === 'flaky') return 'error';
    return 'exists';
  };
  const v = evaluateNames([
    { name: 'lodahs', ecosystem: 'npm', file: 'package.json' },
    { name: 'made-up-pkg-zz', ecosystem: 'npm', file: 'src/a.js' },
    { name: 'flaky', ecosystem: 'npm', file: 'src/b.js' },
  ], lookup);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.findings.length, 2);
  assert.strictEqual(v.warnings.length, 1);
  assert.strictEqual(v.warnings[0].kind, 'lookup-error');
});
