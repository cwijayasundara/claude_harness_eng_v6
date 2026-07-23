'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { packToolOutput, estimateTextTokens } = require('../.claude/scripts/tool-output-pack');
const { applyScaffold } = require('../.claude/scripts/scaffold-apply');

const ROOT = path.join(__dirname, '..');
const PLUGIN_SOURCE = path.join(ROOT, '.claude');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tool-output-pack-'));
}

test('tool output pack preserves failures, raw log, and estimated savings', () => {
  const dir = tempProject();
  try {
    const repeated = Array.from({ length: 80 }, () => 'PASS test/example.test.js ok').join('\n');
    const raw = [
      '> npm test',
      repeated,
      'FAIL test/auth.test.js',
      '  auth rejects expired token',
      '  AssertionError: expected 401, got 200',
      '    at test/auth.test.js:52:10',
      'Tests: 1 failed, 80 passed, 81 total',
    ].join('\n');
    const pack = packToolOutput({ projectDir: dir, kind: 'test', command: 'npm test', raw, exit: 1 });

    assert.strictEqual(pack.kind, 'test');
    assert.strictEqual(pack.exit, 1);
    assert.ok(pack.raw_path.endsWith('.log'), pack.raw_path);
    assert.ok(fs.existsSync(path.join(dir, pack.raw_path)));
    assert.ok(pack.estimated_raw_tokens > pack.estimated_pack_tokens, JSON.stringify(pack));
    assert.ok(pack.estimated_saved_tokens > 0, JSON.stringify(pack));
    assert.match(pack.summary, /failed/i);
    assert.ok(pack.failures.some((f) => f.path === 'test/auth.test.js' && f.line === 52), JSON.stringify(pack.failures));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tool output pack handles successful output without inventing failures', () => {
  const dir = tempProject();
  try {
    const pack = packToolOutput({ projectDir: dir, kind: 'lint', command: 'npm run lint', raw: 'All files pass lint\n', exit: 0 });

    assert.strictEqual(pack.exit, 0);
    assert.deepStrictEqual(pack.failures, []);
    assert.match(pack.summary, /no failures/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('estimateTextTokens is deterministic for tool output telemetry', () => {
  assert.strictEqual(estimateTextTokens(''), 0);
  assert.strictEqual(estimateTextTokens('one two three four'), 5);
});

test('tool output pack CLI writes --out pack json while preserving raw output', () => {
  const dir = tempProject();
  try {
    const raw = path.join(dir, 'raw.log');
    const out = path.join(dir, 'pack.json');
    fs.writeFileSync(raw, 'FAIL test/auth.test.js\n  AssertionError: expected 401, got 200\n    at test/auth.test.js:52:10\n');

    execFileSync(process.execPath, [
      path.join(ROOT, '.claude', 'scripts', 'tool-output-pack.js'),
      '--root', dir,
      '--kind', 'test',
      '--command', 'npm test',
      '--exit', '1',
      '--in', raw,
      '--out', out,
    ]);

    const pack = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(pack.exit, 1);
    assert.ok(pack.raw_path.endsWith('.log'), pack.raw_path);
    assert.ok(fs.existsSync(path.join(dir, pack.raw_path)));
    assert.ok(pack.failures.some((f) => f.path === 'test/auth.test.js' && f.line === 52), JSON.stringify(pack.failures));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('brownfield scaffold copies the tool-output-pack script', () => {
  const dir = tempProject();
  try {
    const profile = path.join(dir, 'profile.json');
    fs.writeFileSync(profile, JSON.stringify({
      name: 'tool-pack-app',
      description: 'tool output pack scaffold test',
      projectType: 'D',
      verificationMode: 'C',
      stack: { backend: null, frontend: null, database: null },
    }));
    applyScaffold({ profile, pluginSource: PLUGIN_SOURCE, target: path.join(dir, 'project'), scaffoldProfile: 'brownfield' });

    assert.ok(fs.existsSync(path.join(dir, 'project', '.claude', 'scripts', 'tool-output-pack.js')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
