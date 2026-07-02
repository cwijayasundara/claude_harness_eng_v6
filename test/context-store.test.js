'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { applyScaffold } = require('../.claude/scripts/scaffold-apply');
const { storeContext, retrieveContext, estimateTextTokens } = require('../.claude/scripts/context-store');

const ROOT = path.join(__dirname, '..');
const PLUGIN_SOURCE = path.join(ROOT, '.claude');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-store-'));
}

test('context store caches raw content by hash and retrieves full content', () => {
  const dir = tempProject();
  try {
    const raw = 'alpha auth failure\nbeta session timeout\nalpha auth failure\n';
    const stored = storeContext({ projectDir: dir, kind: 'test-log', raw, label: 'npm-test' });

    assert.match(stored.hash, /^[a-f0-9]{16}$/);
    assert.strictEqual(stored.kind, 'test-log');
    assert.strictEqual(stored.estimated_raw_tokens, estimateTextTokens(raw));
    assert.ok(stored.raw_path.endsWith(`${stored.hash}.raw`), stored.raw_path);
    assert.ok(fs.existsSync(path.join(dir, stored.raw_path)));

    const retrieved = retrieveContext({ projectDir: dir, hash: stored.hash });
    assert.strictEqual(retrieved.status, 'ok');
    assert.strictEqual(retrieved.raw, raw);
    assert.strictEqual(retrieved.meta.label, 'npm-test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context retrieve narrows cached raw content with a query', () => {
  const dir = tempProject();
  try {
    const raw = [
      'PASS test/users.test.js',
      'FAIL test/auth.test.js expected 401 got 200',
      'PASS test/billing.test.js',
      'ERROR src/auth/session.js:52 expired token accepted',
    ].join('\n');
    const stored = storeContext({ projectDir: dir, kind: 'test-log', raw });
    const retrieved = retrieveContext({ projectDir: dir, hash: stored.hash, query: 'auth token' });

    assert.strictEqual(retrieved.status, 'ok');
    assert.match(retrieved.raw, /auth\.test\.js/);
    assert.match(retrieved.raw, /session\.js:52/);
    assert.doesNotMatch(retrieved.raw, /billing/);
    assert.ok(retrieved.estimated_return_tokens < stored.estimated_raw_tokens, JSON.stringify(retrieved));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context retrieve CLI returns cached content by hash', () => {
  const dir = tempProject();
  try {
    const stored = storeContext({ projectDir: dir, kind: 'generic-text', raw: 'one\ntwo auth\nthree\n' });
    const output = execFileSync(process.execPath, [
      path.join(ROOT, '.claude', 'scripts', 'context-retrieve.js'),
      stored.hash,
      '--root', dir,
      '--query', 'auth',
    ], { encoding: 'utf8' });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.status, 'ok');
    assert.match(parsed.raw, /two auth/);
    assert.doesNotMatch(parsed.raw, /one/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('core scaffold copies context compression scripts', () => {
  const dir = tempProject();
  try {
    const profile = path.join(dir, 'profile.json');
    fs.writeFileSync(profile, JSON.stringify({
      name: 'context-store-app',
      description: 'context store scaffold test',
      projectType: 'D',
      verificationMode: 'C',
      stack: { backend: null, frontend: null, database: null },
    }));
    applyScaffold({ profile, pluginSource: PLUGIN_SOURCE, target: path.join(dir, 'project') });

    for (const script of ['context-store.js', 'context-retrieve.js', 'run-compact.js', 'search-compact.js']) {
      assert.ok(fs.existsSync(path.join(dir, 'project', '.claude', 'scripts', script)), script);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
