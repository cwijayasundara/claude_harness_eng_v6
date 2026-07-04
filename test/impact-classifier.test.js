'use strict';

const assert = require('assert');
const { test } = require('node:test');

const SCRIPT = require.resolve('../.claude/scripts/impact-classifier');
const { classifyImpact, extractFilePaths, riskHits, FILE_THRESHOLD } = require(SCRIPT);

test('extractFilePaths pulls backticked file-like tokens from story text', () => {
  const text = 'Touches `src/api/users.py` and `src/ui/App.tsx`, not `some phrase`.';
  const files = extractFilePaths(text);
  assert.deepStrictEqual(files.sort(), ['src/api/users.py', 'src/ui/App.tsx']);
});

test('riskHits flags an auth-related story', () => {
  assert.deepStrictEqual(riskHits('Add a password reset flow with session tokens'), ['auth']);
});

test('riskHits returns empty for an unrelated story', () => {
  assert.deepStrictEqual(riskHits('Add a footer link to the about page'), []);
});

test('a story touching more than FILE_THRESHOLD files classifies as design-touching', () => {
  const files = ['a.py', 'b.py', 'c.py', 'd.py'];
  assert.ok(files.length > FILE_THRESHOLD);
  const v = classifyImpact({ storyText: 'trivial change', files, graph: null });
  assert.strictEqual(v.classification, 'design-touching');
  assert.match(v.reasons.join(' '), /touches 4 files/);
});

test('a small, risk-free, existing-module story classifies as invisible', () => {
  const graph = { nodes: [{ path: 'src/ui/Footer.tsx' }] };
  const v = classifyImpact({ storyText: 'Add a footer link', files: ['src/ui/Footer.tsx'], graph });
  assert.strictEqual(v.classification, 'invisible');
});

test('a payments-related story classifies as design-touching regardless of file count', () => {
  const v = classifyImpact({ storyText: 'Add a new billing charge endpoint', files: ['src/api/billing.py'], graph: null });
  assert.strictEqual(v.classification, 'design-touching');
  assert.match(v.reasons.join(' '), /payments/);
});

test('a file with no sibling in the code graph is flagged as a new module', () => {
  const graph = { nodes: [{ path: 'src/api/users.py' }] };
  const v = classifyImpact({ storyText: 'Add a notifications worker', files: ['src/workers/notify.py'], graph });
  assert.strictEqual(v.classification, 'design-touching');
  assert.deepStrictEqual(v.new_modules, ['src/workers/notify.py']);
});

test('classifyImpact with no graph never crashes on new-module detection', () => {
  const v = classifyImpact({ storyText: 'trivial', files: ['x.py'], graph: null });
  assert.strictEqual(v.classification, 'invisible');
});
