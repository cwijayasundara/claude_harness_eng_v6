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

// The import patterns used to run over raw source, so ordinary prose in a
// comment parsed as a dependency. `phase-cost.js` carries the line
//   // honesty note from "main-loop only" to a false "subagents pooled".
// which the bare /from\s+['"]…['"]/ pattern read as an import of a package
// called `main-loop only`, and the gate blocked the commit as a slopsquat.
// The gate only scans STAGED files, so it fired the first time that file was
// touched — years of commits could pass before a comment like this bites.
test('extractJsSpecs ignores imports that are only mentioned in comments', () => {
  const js = [
    'const real = require("axios");',
    '// honesty note from "main-loop only" to a false "subagents pooled".',
    '/* migrate from "old-pkg" to the new one; see import x from "other-pkg" */',
    'import y from "lodash";',
  ].join('\n');
  assert.deepStrictEqual(extractJsSpecs(js).sort(), ['axios', 'lodash']);
});

// The dangerous direction is the opposite one: stripping comments must never
// swallow a real import, or a hallucinated package walks through a security
// gate. `//` inside a string, and the escaped slashes of a regex literal, must
// not be mistaken for the start of a comment.
test('extractJsSpecs still finds imports around strings and regex literals', () => {
  const js = [
    'const url = "https://example.com/not-a-comment";',
    'const re = /^https?:\\/\\//;',
    'const tpl = `see https://x/y`;',
    'const evil = require("sketchy-pkg");',
    'import a from "real-pkg";',
  ].join('\n');
  assert.deepStrictEqual(extractJsSpecs(js).sort(), ['real-pkg', 'sketchy-pkg']);
});

// An unescaped `/` is legal inside a regex character class (`/[/]/` parses fine
// since ES2015), so `/[/*]/` opened what looked like a block comment and blanked
// the rest of the file — losing a real require(). That is the false-negative
// direction on a security gate: a hallucinated package walks straight through.
// Regex literals are now consumed as literals, so comment openers inside them
// are inert.
test('extractJsSpecs survives regex literals containing comment openers', () => {
  // The first two are the ones that actually pin the regex-literal branch:
  // disable it and both lose their import. The rest passed with the branch
  // disabled — rescued by the unterminated-`/*` guard or by the import simply
  // being on the next line — so they document intent but guard nothing.
  const cases = [
    'const re = /[/*]/;\nconst evil = require("sketchy-pkg");\n/* a real comment */',
    'const re = /[//]/; const a = require("real-pkg");',
    'const re = /[/*]/;\nconst evil = require("sketchy-pkg");',
    'const re = /[//]/;\nimport a from "real-pkg";',
    'const re = /a\\/\\/b/;\nconst x = require("axios");',
    'const d = total / count; // ratio\nconst y = require("lodash");',
  ];
  const expected = [['sketchy-pkg'], ['real-pkg'], ['sketchy-pkg'], ['real-pkg'],
    ['axios'], ['lodash']];
  cases.forEach((src, i) => {
    assert.deepStrictEqual(extractJsSpecs(src).sort(), expected[i], `case ${i}: ${src}`);
  });
});
