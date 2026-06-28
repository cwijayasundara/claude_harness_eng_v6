'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ctx = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'contexts.js'));

const CONFIG = {
  roots: ['src/billing', 'src/user'],
  names: ['billing', 'user'],
  allow: [['billing', 'user']], // billing may import user; user may NOT import billing
  public: ['index', 'public', '__init__'],
};

test('loadContextConfig is opt-in: null unless configured', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
  assert.strictEqual(ctx.loadContextConfig(dir), null, 'no manifest → off');
  fs.writeFileSync(path.join(dir, 'project-manifest.json'),
    JSON.stringify({ architecture: { contexts: { roots: ['src/billing', 'src/user'] } } }));
  const cfg = ctx.loadContextConfig(dir);
  assert.deepStrictEqual(cfg.names, ['billing', 'user']);
  assert.deepStrictEqual(cfg.public, ['index', 'public', '__init__']);
});

test('fileContext resolves a file to its owning context', () => {
  assert.strictEqual(ctx.fileContext('src/user/internal/service.py', CONFIG), 'user');
  assert.strictEqual(ctx.fileContext('src/shared/util.py', CONFIG), null);
});

test('importedContext + isPublicImport classify the target', () => {
  assert.strictEqual(ctx.importedContext('../billing/internal/calc', CONFIG.names), 'billing');
  assert.strictEqual(ctx.isPublicImport('../billing/internal/calc', 'billing', CONFIG.public), false);
  assert.strictEqual(ctx.isPublicImport('../billing/index', 'billing', CONFIG.public), true);
  assert.strictEqual(ctx.isPublicImport('../billing', 'billing', CONFIG.public), true, 'root import is public');
});

test('JS: reaching into another context internals is a violation; public is fine', () => {
  const bad = "import { calc } from '../billing/internal/calc';";
  const v = ctx.checkContextContent('src/user/service.ts', bad, CONFIG);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].from, 'user');
  assert.strictEqual(v[0].to, 'billing');

  const ok = "import { pay } from '../billing/index';";
  assert.deepStrictEqual(ctx.checkContextContent('src/user/service.ts', ok, CONFIG), []);
});

test('an allowed edge permits even internal imports', () => {
  // billing → user is allowed
  const dep = "import { profile } from '../user/internal/profile';";
  assert.deepStrictEqual(ctx.checkContextContent('src/billing/service.ts', dep, CONFIG), []);
  // but user → billing internal is not
  const rev = "import { x } from '../billing/internal/x';";
  assert.strictEqual(ctx.checkContextContent('src/user/service.ts', rev, CONFIG).length, 1);
});

test('Python dotted imports across contexts are caught', () => {
  const bad = 'from src.billing.internal.calc import total\n';
  const v = ctx.checkContextContent('src/user/service.py', bad, CONFIG);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].to, 'billing');
  const pub = 'from src.billing import api\n';
  assert.deepStrictEqual(ctx.checkContextContent('src/user/service.py', pub, CONFIG), []);
});

test('same-context and non-context files never violate', () => {
  const same = "import { calc } from './internal/calc';";
  assert.deepStrictEqual(ctx.checkContextContent('src/billing/service.ts', same, CONFIG), []);
  assert.deepStrictEqual(ctx.checkContextContent('src/shared/u.ts', "import x from '../billing/internal/x'", CONFIG), []);
});

test('a null config (unconfigured project) is always a no-op', () => {
  assert.deepStrictEqual(ctx.checkContextContent('src/user/s.ts', "import x from '../billing/internal/x'", null), []);
});
