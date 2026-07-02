'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const TOKEN_ADVISOR = path.join(ROOT, '.claude', 'hooks', 'token-advisor.js');
const PRE_BASH_GATE = path.join(ROOT, '.claude', 'hooks', 'pre-bash-gate.js');
const RUN_COMPACT = path.join(ROOT, '.claude', 'scripts', 'run-compact.js');
const RETRIEVE = path.join(ROOT, '.claude', 'scripts', 'context-retrieve.js');
const STATUS = path.join(ROOT, '.claude', 'scripts', 'pipeline-status.js');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-compression-e2e-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    token_governor: {
      enabled: true,
      mode: 'advisory',
      max_source_read_lines: 300,
      compress_tool_output: true,
      ccr_enabled: true,
      preserve_full_outputs: true,
    },
  }));
  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), Array.from({ length: 360 }, (_, i) => `// auth line ${i}`).join('\n'));
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({
    files: [
      { path: 'src/auth.js', symbols: [{ name: 'validateSession', kind: 'function', start: 40, end: 80 }] },
    ],
    nodes: [],
    edges: [],
  }));
  return dir;
}

function runHook(projectDir, hook, input) {
  return spawnSync(process.execPath, [hook], {
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

test('token compression e2e warns without blocking and preserves reversible compact output', () => {
  const dir = makeProject();
  try {
    const readResult = runHook(dir, TOKEN_ADVISOR, {
      tool_name: 'Read',
      tool_input: { file_path: path.join(dir, 'src', 'auth.js') },
    });
    assert.strictEqual(readResult.status, 0, readResult.stderr);
    assert.match(readResult.stdout, /TOKEN ADVISORY: broad source read/);
    assert.match(readResult.stdout, /\/context/);

    const bashAdvisor = runHook(dir, TOKEN_ADVISOR, {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    assert.strictEqual(bashAdvisor.status, 0, bashAdvisor.stderr);
    assert.match(bashAdvisor.stdout, /run-compact\.js --kind test -- npm test/);

    const bashGate = runHook(dir, PRE_BASH_GATE, {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    assert.strictEqual(bashGate.status, 0, bashGate.stdout);

    const noisy = path.join(dir, 'noisy-test.js');
    fs.writeFileSync(noisy, [
      "for (let i = 0; i < 100; i += 1) console.log('PASS test/example-' + i + '.test.js ok');",
      "console.log('FAIL test/auth.test.js');",
      "console.log('  auth rejects expired token');",
      "console.log('  AssertionError: expected 401, got 200');",
      "console.log('    at test/auth.test.js:52:10');",
      'process.exit(1);',
    ].join('\n'));
    const compact = spawnSync(process.execPath, [
      RUN_COMPACT,
      '--root', dir,
      '--kind', 'test',
      '--',
      process.execPath,
      noisy,
    ], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(compact.status, 1, 'run-compact must preserve command exit status');
    const pack = JSON.parse(compact.stdout);
    assert.ok(pack.estimated_saved_tokens > 0, JSON.stringify(pack));
    assert.ok(pack.estimated_pack_tokens < pack.estimated_raw_tokens, JSON.stringify(pack));
    assert.ok(pack.failures.some((f) => f.path === 'test/auth.test.js' && f.line === 52), JSON.stringify(pack.failures));

    const retrieved = spawnSync(process.execPath, [RETRIEVE, pack.context_hash, '--root', dir, '--query', 'auth'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.strictEqual(retrieved.status, 0, retrieved.stderr);
    const raw = JSON.parse(retrieved.stdout);
    assert.strictEqual(raw.status, 'ok');
    assert.match(raw.raw, /test\/auth\.test\.js/);
    assert.doesNotMatch(raw.raw, /example-99/);

    const status = spawnSync(process.execPath, [STATUS, 'status', '--json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.strictEqual(status.status, 0, status.stderr);
    const snapshot = JSON.parse(status.stdout);
    assert.strictEqual(snapshot.token_advisor.warnings, 2);
    assert.strictEqual(snapshot.token_advisor.by_kind.broad_source_read, 1);
    assert.strictEqual(snapshot.token_advisor.by_kind.verbose_command, 1);
    assert.strictEqual(snapshot.context_cache.entries, 1);
    assert.ok(snapshot.context_cache.estimated_saved_tokens > 0, JSON.stringify(snapshot.context_cache));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
