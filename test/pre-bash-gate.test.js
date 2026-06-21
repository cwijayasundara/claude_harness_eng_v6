const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'pre-bash-gate.js';

function bash(projectDir, command, env) {
  return runHook(projectDir, HOOK, { tool_name: 'Bash', tool_input: { command } }, env);
}

// --- scope ---

test('blocks a bash redirection that writes outside the project', async () => {
  const projectDir = makeHookProject([HOOK]);
  const outside = path.join(makeHookProject([]), 'evil.txt');
  const result = await bash(projectDir, `echo pwned > ${outside}`);
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(result.stdout.includes('outside the project directory'), result.stdout);
});

test('allows a bash write to an ordinary project file', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await bash(projectDir, 'echo "const a = 1;" > src/app.js');
  assert.strictEqual(result.status, 0, result.stdout);
});

test('allows read-only commands', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of ['cat README.md', 'grep -r foo src/', 'ls -la', 'npm test']) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 0, `${cmd}: ${result.stdout}`);
  }
});

test('allows /dev/null and other device sinks (the 2>/dev/null idiom)', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of [
    'node --check file.js 2>/dev/null',
    'make build > /dev/null 2>&1',
    'echo hi > /dev/stdout',
  ]) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 0, `${cmd}: ${result.stdout}`);
  }
});

// --- machinery trust boundary (the core hole this closes) ---

const MACHINERY_WRITES = [
  'echo "" > .claude/hooks/pre-write-gate.js',
  'tee .claude/git-hooks/pre-commit < /dev/null',
  "sed -i 's/.*/return;/' .claude/hooks/lib/tdd.js",
  'cp /dev/null .claude/settings.json',
  'echo 100 > .claude/state/coverage-baseline.txt',
];

test('blocks bash writes to harness machinery in a target project', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of MACHINERY_WRITES) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 2, `not blocked: ${cmd} -> ${result.stdout}`);
    assert.ok(result.stdout.includes('machinery'), `${cmd}: ${result.stdout}`);
  }
});

test('does not block bash writes to ordinary .claude content', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const cmd of ['echo notes > .claude/program.md', 'echo x > .claude/state/learned-rules.md']) {
    const result = await bash(projectDir, cmd);
    assert.strictEqual(result.status, 0, `${cmd}: ${result.stdout}`);
  }
});

test('machinery writes are allowed inside the harness repo itself', async () => {
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'claude-harness-eng-v5' }));
  const result = await bash(projectDir, 'echo ok > .claude/hooks/new-hook.js');
  assert.strictEqual(result.status, 0, result.stdout);
});

test('HARNESS_PROTECT=off bypasses the machinery gate deliberately', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await bash(projectDir, 'echo "{}" > .claude/settings.json', { HARNESS_PROTECT: 'off' });
  assert.strictEqual(result.status, 0, result.stdout);
});

// --- protected env files ---

test('blocks a bash write to .env but allows .env.example', async () => {
  const projectDir = makeHookProject([HOOK]);
  const blocked = await bash(projectDir, 'echo "KEY=secret" > .env');
  assert.strictEqual(blocked.status, 2, blocked.stdout);
  assert.ok(blocked.stdout.includes('environment files'), blocked.stdout);

  const allowed = await bash(projectDir, 'echo "KEY=" > .env.example');
  assert.strictEqual(allowed.status, 0, allowed.stdout);
});

// --- non-Bash inputs are ignored ---

test('ignores non-Bash tool calls', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, '.claude', 'settings.json'), content: '{}' },
  });
  assert.strictEqual(result.status, 0, result.stdout);
});
