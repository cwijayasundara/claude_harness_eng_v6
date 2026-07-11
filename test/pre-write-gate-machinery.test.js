const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

// Split out of pre-write-gate.test.js (the "trust boundary" section) so each
// file stays under the harness's file-length gate.

const HOOK = 'pre-write-gate.js';
const ENV = { HARNESS_TDD_GATE: 'off' };

// --- trust boundary (harness machinery) ---

const MACHINERY_TARGETS = [
  '.claude/hooks/pre-write-gate.js',
  '.claude/hooks/lib/tdd.js',
  '.claude/git-hooks/pre-commit',
  '.claude/settings.json',
  '.claude/security-patterns.json',
  '.claude/state/coverage-baseline.txt',
  '.claude/state/coverage-baseline-js.txt',
  '.claude/state/coverage-preflight-cache.json',
  '.claude/state/hook-errors.log',
];

test('blocks writes to harness machinery in a target project', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const rel of MACHINERY_TARGETS) {
    const result = await runHook(projectDir, HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(projectDir, rel), content: 'tampered\n' },
    }, ENV);
    assert.strictEqual(result.status, 2, `${rel} was not blocked`);
    assert.ok(result.stdout.includes('machinery'), `${rel}: ${result.stdout}`);
  }
});

test('machinery protection does not block ordinary .claude content', async () => {
  const projectDir = makeHookProject([HOOK]);
  for (const rel of ['.claude/state/learned-rules.md', '.claude/program.md', '.claude/skills/foo/SKILL.md']) {
    const result = await runHook(projectDir, HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(projectDir, rel), content: 'notes\n' },
    }, ENV);
    assert.strictEqual(result.status, 0, `${rel} was blocked: ${result.stdout}`);
  }
});

test('machinery edits are allowed inside the harness repo itself', async () => {
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'claude-harness-eng-v5' }));
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, '.claude', 'hooks', 'new-hook.js'), content: 'ok\n' },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('HARNESS_PROTECT=off bypasses the machinery gate deliberately', async () => {
  const projectDir = makeHookProject([HOOK]);
  // Use a machinery path that is NOT also a prompt-cache prefix file
  // (.claude/settings.json is dual-guarded; HARNESS_PROTECT alone is not enough).
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(projectDir, '.claude', 'security-patterns.json'),
      content: '[]\n',
    },
  }, { ...ENV, HARNESS_PROTECT: 'off' });
  assert.strictEqual(result.status, 0, result.stdout);
});

// --- Claude Code per-project memory directory ---

function mungedProject(projectDir) {
  return fs.realpathSync(projectDir).replace(/[^a-zA-Z0-9-]/g, '-');
}

test("allows writes to this project's Claude memory directory", async () => {
  const projectDir = makeHookProject([HOOK]);
  const memoryFile = path.join(os.homedir(), '.claude', 'projects', mungedProject(projectDir), 'memory', 'note.md');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: memoryFile, content: '# memory\n' },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test("still blocks writes to a DIFFERENT project's Claude memory directory", async () => {
  const projectDir = makeHookProject([HOOK]);
  const otherFile = path.join(os.homedir(), '.claude', 'projects', '-Users-someone-else-project', 'memory', 'note.md');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: otherFile, content: '# memory\n' },
  }, ENV);
  assert.strictEqual(result.status, 2, result.stdout);
});
