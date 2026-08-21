'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HARNESS_ROOT = path.join(__dirname, '..', '..', '..');

function withEnv(value, fn) {
  const prior = process.env.HARNESS_E2E_WORKDIR;
  if (value === null) delete process.env.HARNESS_E2E_WORKDIR;
  else process.env.HARNESS_E2E_WORKDIR = value;
  // The module caches nothing, but re-require to keep each case independent.
  delete require.cache[require.resolve('./e2e-workdir')];
  try {
    return fn(require('./e2e-workdir'));
  } finally {
    if (prior === undefined) delete process.env.HARNESS_E2E_WORKDIR;
    else process.env.HARNESS_E2E_WORKDIR = prior;
    delete require.cache[require.resolve('./e2e-workdir')];
  }
}

test('default workdir lives outside the harness checkout', () => {
  withEnv(null, ({ e2eWorkdir }) => {
    const dir = e2eWorkdir('plan');
    const real = fs.realpathSync.native(HARNESS_ROOT);
    assert.ok(
      !dir.startsWith(real + path.sep),
      `live e2e output must not land in the repo: ${dir} is inside ${real}`,
    );
    assert.ok(dir.startsWith(fs.realpathSync.native(os.tmpdir())), `expected a tmpdir path, got ${dir}`);
  });
});

test('HARNESS_E2E_WORKDIR overrides the root', () => {
  const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-workdir-override-'));
  try {
    withEnv(custom, ({ e2eWorkdir, e2eRoot }) => {
      assert.equal(e2eRoot(), fs.realpathSync.native(custom));
      assert.equal(e2eWorkdir('plan'), path.join(fs.realpathSync.native(custom), 'plan'));
    });
  } finally {
    fs.rmSync(custom, { recursive: true, force: true });
  }
});

test('each route gets its own dir under one root', () => {
  withEnv(null, ({ e2eWorkdir, e2eRoot }) => {
    assert.notEqual(e2eWorkdir('plan'), e2eWorkdir('front-half'));
    assert.equal(path.dirname(e2eWorkdir('front-half')), e2eRoot());
  });
});

// These names are handed to freshProject, which rm -rf's the result. A name
// that escapes its root would aim that delete somewhere else.
test('rejects a name that is not a single path segment', () => {
  withEnv(null, ({ e2eWorkdir }) => {
    for (const bad of ['..', '.', 'a/b', '../escape', '/abs', 'a\\b', '', 'a b']) {
      assert.throws(() => e2eWorkdir(bad), /single path segment/, `should reject ${JSON.stringify(bad)}`);
    }
    for (const bad of [null, undefined, 42, {}]) {
      assert.throws(() => e2eWorkdir(bad), /single path segment/);
    }
  });
});
