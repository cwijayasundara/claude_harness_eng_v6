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
  // PR3 moved dispatch from the pre-commit script itself into gate-registry.js's
  // declarative GATE_CATALOG — assert against the real catalog, not prose.
  const { GATE_CATALOG } = require('../.claude/hooks/lib/gate-registry.js');
  const early = require('../.claude/hooks/lib/gates-early.js');
  const entry = GATE_CATALOG.find((g) => g.id === 'bounded-context-rules');
  assert.ok(entry, 'GATE_CATALOG must register bounded-context-rules');
  assert.strictEqual(entry.run, early.checkContexts, 'must dispatch to the real gate function, not a copy');

  const src = read('.claude/hooks/lib/gates-early.js');
  assert.match(src, /require\('\.\/contexts'\)/, 'must require the contexts lib');
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
