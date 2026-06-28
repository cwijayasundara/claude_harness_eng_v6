'use strict';

// Locks the G8 wiring: the bounded-context check runs in both the inner-loop
// (verify-on-save) and commit (pre-commit) gates, stays opt-in, and the manifest
// marks it active.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('verify-on-save runs the bounded-context check', () => {
  const src = read('.claude/hooks/verify-on-save.js');
  assert.match(src, /require\('\.\/lib\/contexts'\)/, 'must import contexts');
  assert.match(src, /checkContextContent\(n, content, loadContextConfig\(projectDir\)\)/);
});

test('pre-commit runs the bounded-context check', () => {
  const src = read('.claude/git-hooks/pre-commit');
  assert.match(src, /lib', 'contexts'\)|hooks', 'lib', 'contexts'/, 'must require the contexts lib');
  assert.match(src, /checkContexts\(projectDir, stagedSource\)/, 'must call checkContexts');
});

test('the contexts check is opt-in (off unless architecture.contexts is set)', () => {
  const { loadContextConfig, checkContextContent } = require(path.join(ROOT, '.claude/hooks/lib/contexts.js'));
  // a dir with no manifest → null config → no-op
  assert.strictEqual(loadContextConfig(path.join(ROOT, 'test')), null);
  assert.deepStrictEqual(checkContextContent('src/a/x.ts', "import y from '../b/internal/y'", null), []);
});

test('manifest marks bounded-context-rules active', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'bounded-context-rules');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.wired_at, '.claude/hooks/lib/contexts.js');
  assert.ok(!('gap_ref' in s), 'no longer a gap');
});
