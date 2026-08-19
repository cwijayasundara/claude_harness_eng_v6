'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { checkStaged, run } = require('../.claude/scripts/registry-name-gate');

function fakeExec(map) {
  return (cmd, args) => {
    const key = args.join(' ');
    if (key in map) {
      const v = map[key];
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error(`unstubbed git call: ${cmd} ${key}`);
  };
}

const HEAD_PKG = JSON.stringify({ dependencies: { axios: '1.0.0' } });
const STAGED_PKG = JSON.stringify({ dependencies: { axios: '1.0.0', lodahs: '1.0.0' } });

test('checkStaged flags a new typosquat in package.json', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'package.json\n',
    'show :package.json': STAGED_PKG,
    'show HEAD:package.json': HEAD_PKG,
    'show HEAD:requirements.txt': new Error('missing'),
    'show HEAD:package-lock.json': new Error('missing'),
    'show HEAD:npm-shrinkwrap.json': new Error('missing'),
  });
  const v = checkStaged(exec, () => 'exists');
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.findings[0].kind, 'typosquat');
  assert.strictEqual(v.findings[0].name, 'lodahs');
});

test('checkStaged passes when only already-declared imports change', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'src/a.js\n',
    'show :src/a.js': "const axios = require('axios');\n",
    'show HEAD:package.json': HEAD_PKG,
    'show HEAD:requirements.txt': new Error('missing'),
    'show HEAD:package-lock.json': new Error('missing'),
    'show HEAD:npm-shrinkwrap.json': new Error('missing'),
  });
  assert.strictEqual(checkStaged(exec, () => 'missing').pass, true);
});

test('run returns 2 without --staged, 0 clean, 1 dirty', () => {
  const clean = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': '',
    'show HEAD:package.json': HEAD_PKG,
    'show HEAD:requirements.txt': new Error('missing'),
    'show HEAD:package-lock.json': new Error('missing'),
    'show HEAD:npm-shrinkwrap.json': new Error('missing'),
  });
  const lookup = () => 'exists';
  assert.strictEqual(run([], '/x', { exec: clean, lookup }), 2);
  assert.strictEqual(run(['--staged'], '/x', { exec: clean, lookup }), 0);
  const dirty = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'src/a.js\n',
    'show :src/a.js': "import x from 'made-up-pkg-zz';\n",
    'show HEAD:package.json': HEAD_PKG,
    'show HEAD:requirements.txt': new Error('missing'),
    'show HEAD:package-lock.json': new Error('missing'),
    'show HEAD:npm-shrinkwrap.json': new Error('missing'),
  });
  assert.strictEqual(run(['--staged'], '/x', { exec: dirty, lookup: () => 'missing' }), 1);
});
