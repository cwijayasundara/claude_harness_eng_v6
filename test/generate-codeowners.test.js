'use strict';

// CODEOWNERS generator (Increment 2, C3). Config-driven, idempotent, no client
// literals — owners come only from github.default_owners / github.path_owners.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'generate-codeowners.js');
const { renderCodeowners, writeCodeowners } = require(SCRIPT);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codeowners-'));
}

test('renderCodeowners emits a "* <owners>" catch-all from default_owners', () => {
  const out = renderCodeowners({ default_owners: ['@org/team', '@org/security'] });
  assert.match(out, /^\* @org\/team @org\/security$/m);
});

test('renderCodeowners appends per-path entries from path_owners', () => {
  const out = renderCodeowners({
    default_owners: ['@org/team'],
    path_owners: { '/infra/': ['@org/platform'], '*.sql': ['@org/dba'] },
  });
  assert.match(out, /^\* @org\/team$/m);
  assert.match(out, /^\/infra\/ @org\/platform$/m);
  assert.match(out, /^\*\.sql @org\/dba$/m);
});

test('renderCodeowners returns null when default_owners is empty (skip, no file)', () => {
  assert.strictEqual(renderCodeowners({ default_owners: [] }), null);
  assert.strictEqual(renderCodeowners({}), null);
  assert.strictEqual(renderCodeowners(null), null);
});

test('renderCodeowners is deterministic (idempotent regeneration)', () => {
  const g = { default_owners: ['@org/a'], path_owners: { '/x/': ['@org/b'] } };
  assert.strictEqual(renderCodeowners(g), renderCodeowners(g));
});

test('writeCodeowners writes .github/CODEOWNERS when owners are configured', () => {
  const dir = tmp();
  const out = writeCodeowners(dir, { default_owners: ['@org/team'] });
  assert.ok(out && fs.existsSync(out));
  assert.strictEqual(out, path.join(dir, '.github', 'CODEOWNERS'));
  assert.match(fs.readFileSync(out, 'utf8'), /^\* @org\/team$/m);
});

test('writeCodeowners skips (returns null, writes nothing) when owners are empty', () => {
  const dir = tmp();
  const out = writeCodeowners(dir, { default_owners: [] });
  assert.strictEqual(out, null);
  assert.strictEqual(fs.existsSync(path.join(dir, '.github', 'CODEOWNERS')), false);
});
