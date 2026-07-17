'use strict';

// Regression coverage for the token-governor false positives that "blocked me
// constantly" during the harness-simplification work: the verbose-command
// detector matched the bare word test/build/lint anywhere (so `test -d x`,
// `git add test/foo.test.js`, `du … test`, and commit messages were blocked),
// and the broad-read guard fired on test/doc/spec files, not just product source.
// Both feed enforced mode, so these were hard blocks, not warnings.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { adviseTokenUsage } = require('../.claude/hooks/token-advisor');
const { verboseKind } = require('../.claude/hooks/lib/verbose-command');

function tempProject(mode = 'enforced') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-falsepos-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    token_governor: { enabled: true, mode, max_source_read_lines: 300, compress_tool_output: true },
  }));
  return dir;
}

function writeGraph(dir, filePath) {
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({
    files: [{ path: filePath, symbols: [{ name: 'f', kind: 'function', start: 10, end: 90 }] }],
    nodes: [], edges: [],
  }));
}

// --- verboseKind unit cases (the core false positives) ---------------------

const NOT_VERBOSE = [
  'test -d harness-lite/.claude',
  'test -f package.json',
  '[ -d src ] && echo yes',
  'git add test/control-budget.test.js',
  'git commit -m "add test coverage"',
  'git commit -F /tmp/msg.txt',
  'du -sh packages harness-lite symphony_clone test',
  'for d in packages test; do echo $d; done',
  'ls test',
  'grep -rln pattern test',
  'cat test/fixtures/build.json',
  // compound / multi-line commands where git is not the first token, and tool
  // names appear only inside the commit message:
  'cd /repo && git commit -m "run npm test and pytest, fix build"',
  'cd /repo\ngit commit -F /tmp/msg.txt',
  'cd /repo && git add test/foo.test.js',
];

const VERBOSE = [
  ['npm test', 'test'],
  ['npm run test:e2e', 'test'],
  ['node --test test/control-budget.test.js', 'test'],
  ['pytest tests/unit', 'test'],
  ['jest --watch', 'test'],
  ['playwright test', 'test'],
  ['npm run build', 'build-log'],
  ['tsc --noEmit', 'build-log'],
  ['npx eslint .claude', 'lint'],
  ['ruff check .', 'lint'],
  ['cd /repo && npm test', 'test'],
];

test('verboseKind: the word test/build/lint as path/arg/builtin is NOT a runner', () => {
  for (const cmd of NOT_VERBOSE) {
    assert.strictEqual(verboseKind(cmd), null, `should be null: ${cmd}`);
  }
});

test('verboseKind: real runners are still detected with the right kind', () => {
  for (const [cmd, kind] of VERBOSE) {
    assert.strictEqual(verboseKind(cmd), kind, `should be ${kind}: ${cmd}`);
  }
});

// --- end-to-end through adviseTokenUsage in ENFORCED mode ------------------

test('enforced mode does NOT block git/test-file/builtin commands', () => {
  const dir = tempProject('enforced');
  try {
    for (const command of NOT_VERBOSE) {
      const result = adviseTokenUsage({ projectDir: dir, input: { tool_name: 'Bash', tool_input: { command } } });
      assert.strictEqual(result.decision, 'ok', `wrongly flagged: ${command}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('enforced mode still blocks a genuine verbose runner', () => {
  const dir = tempProject('enforced');
  try {
    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    });
    assert.strictEqual(result.decision, 'block');
    assert.match(result.message, /run-compact\.js --kind test/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- broad-read guard: test/doc/spec files are not "source" ----------------

test('broad-read guard ignores a large test file (not product source)', () => {
  const dir = tempProject('enforced');
  try {
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'big.test.js'), Array.from({ length: 360 }, (_, i) => `line ${i}`).join('\n'));
    writeGraph(dir, 'tests/big.test.js');
    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'tests', 'big.test.js') } },
    });
    assert.strictEqual(result.decision, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('broad-read guard still fires on a large product-source file', () => {
  const dir = tempProject('enforced');
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'auth.js'), Array.from({ length: 360 }, (_, i) => `line ${i}`).join('\n'));
    writeGraph(dir, 'src/auth.js');
    const result = adviseTokenUsage({
      projectDir: dir,
      input: { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src', 'auth.js') } },
    });
    assert.strictEqual(result.decision, 'block');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
