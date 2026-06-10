const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'enforce-length-pre.js';

function makeSourceFile(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-length-'));
  const filePath = path.join(dir, 'module.ts');
  fs.writeFileSync(filePath, Array.from({ length: lines }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n');
  return filePath;
}

function bigBlock(lines) {
  return Array.from({ length: lines }, (_, i) => `const big${i} = ${i};`).join('\n') + '\n';
}

test('blocks a Write that exceeds the hard limit', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'module.ts'), content: bigBlock(501) },
  });

  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('BLOCKED'), `expected BLOCKED, got: ${result.stdout}`);
});

test('blocks a MultiEdit that pushes an existing file over the hard limit', async () => {
  const projectDir = makeHookProject([HOOK]);
  const filePath = makeSourceFile(490);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: filePath,
      edits: [
        { old_string: 'const v0 = 0;', new_string: bigBlock(10).trimEnd() },
        { old_string: 'const v1 = 1;', new_string: bigBlock(10).trimEnd() },
      ],
    },
  });

  assert.strictEqual(result.status, 2, `expected block, got status ${result.status}: ${result.stdout}`);
  assert.ok(result.stdout.includes('BLOCKED'));
});

test('blocks a MultiEdit that creates a new oversized file', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: path.join(projectDir, 'src', 'fresh.ts'),
      edits: [{ old_string: '', new_string: bigBlock(501) }],
    },
  });

  assert.strictEqual(result.status, 2, `expected block, got status ${result.status}: ${result.stdout}`);
  assert.ok(result.stdout.includes('BLOCKED'));
});

test('allows a MultiEdit that stays under the hard limit', async () => {
  const projectDir = makeHookProject([HOOK]);
  const filePath = makeSourceFile(100);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: filePath,
      edits: [{ old_string: 'const v0 = 0;', new_string: 'const v0 = 42;' }],
    },
  });

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('does not block a MultiEdit whose old_string is missing (the tool itself will fail)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const filePath = makeSourceFile(490);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: filePath,
      edits: [{ old_string: 'NOT PRESENT ANYWHERE', new_string: bigBlock(100) }],
    },
  });

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});
