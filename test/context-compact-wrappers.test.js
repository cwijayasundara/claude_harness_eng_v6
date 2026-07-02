'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-compact-'));
}

test('run-compact executes a command, stores raw output, and returns a compact pack', () => {
  const dir = tempProject();
  try {
    const script = path.join(dir, 'emit.js');
    fs.writeFileSync(script, [
      "for (let i = 0; i < 60; i += 1) console.log('PASS test/example.test.js ok');",
      "console.log('FAIL test/auth.test.js');",
      "console.log('  auth rejects expired token');",
      "console.log('  AssertionError: expected 401, got 200');",
      "console.log('    at test/auth.test.js:52:10');",
      'process.exit(1);',
    ].join('\n'));

    const result = spawnSync(process.execPath, [
      path.join(ROOT, '.claude', 'scripts', 'run-compact.js'),
      '--root', dir,
      '--kind', 'test',
      '--',
      process.execPath,
      script,
    ], { encoding: 'utf8' });
    const pack = JSON.parse(result.stdout);

    assert.strictEqual(result.status, 1);
    assert.strictEqual(pack.exit, 1);
    assert.match(pack.summary, /FAIL|failed|failure/i);
    assert.ok(pack.context_hash, JSON.stringify(pack));
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'state', 'context-cache', `${pack.context_hash}.raw`)));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'state', 'context-cache', `${pack.context_hash}.json`), 'utf8'));
    assert.strictEqual(meta.estimated_pack_tokens, pack.estimated_pack_tokens);
    assert.strictEqual(meta.estimated_saved_tokens, pack.estimated_saved_tokens);
    assert.ok(pack.failures.some((f) => f.path === 'test/auth.test.js' && f.line === 52), JSON.stringify(pack.failures));
    assert.ok(pack.estimated_saved_tokens > 0, JSON.stringify(pack));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('search-compact groups matching lines by file and stores full search output', () => {
  const dir = tempProject();
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'function validateSession() {}\nconst token = "expired";\n');
    fs.writeFileSync(path.join(dir, 'src', 'billing.js'), 'function billCustomer() {}\n');
    const output = execFileSync(process.execPath, [
      path.join(ROOT, '.claude', 'scripts', 'search-compact.js'),
      '--root', dir,
      '--pattern', 'function|token',
      '--glob', 'src/*.js',
    ], { encoding: 'utf8' });
    const pack = JSON.parse(output);

    assert.strictEqual(pack.status, 'ok');
    assert.ok(pack.context_hash, JSON.stringify(pack));
    assert.ok(pack.files.some((f) => f.path === 'src/auth.js' && f.matches.length === 2), JSON.stringify(pack.files));
    assert.ok(pack.files.some((f) => f.path === 'src/billing.js' && f.matches.length === 1), JSON.stringify(pack.files));
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'state', 'context-cache', `${pack.context_hash}.raw`)));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'state', 'context-cache', `${pack.context_hash}.json`), 'utf8'));
    assert.strictEqual(meta.estimated_pack_tokens, pack.estimated_pack_tokens);
    assert.strictEqual(meta.estimated_saved_tokens, pack.estimated_saved_tokens);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
