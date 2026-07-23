const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'pre-write-gate.js';

// Fake secrets assembled at runtime so this file never contains a contiguous
// secret-shaped string on disk (which would trip secret scanners on the repo).
const FAKE_AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const FAKE_GH_TOKEN = 'ghp' + '_abcdef0123456789';
const FAKE_SSN = ['123', '45', '6789'].join('-');
// The gate enforces the TDD check too; most tests target other checks, so they
// run with the TDD layer off and turn it on only in the TDD-specific tests.
const ENV = { HARNESS_TDD_GATE: 'off' };

function lines(n, prefix = 'v') {
  return Array.from({ length: n }, (_, i) => `const ${prefix}${i} = ${i};`).join('\n') + '\n';
}

function srcFile(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (content !== undefined) fs.writeFileSync(p, content);
  return p;
}

// --- bite ledger ---
// Every session-cadence check records ran/blocked/elapsed. The BLOCK path is the one
// that matters and the one that is easy to get wrong: block() exits the process
// instead of throwing, so the outcome has to be written on the way out.

function ledger(projectDir) {
  const { readOutcomes } = require('../.claude/hooks/lib/sensor-outcomes');
  return readOutcomes(projectDir);
}

test('a passing write records one non-blocked outcome per check', async () => {
  const projectDir = makeHookProject([HOOK]);
  const file = srcFile(projectDir, 'src/ok.py', 'x = 1\n');
  const res = await runHook(projectDir, HOOK, {
    tool_name: 'Write', tool_input: { file_path: file, content: 'x = 2\n' },
  }, ENV);
  assert.strictEqual(res.status, 0, res.stdout);
  const rows = ledger(projectDir);
  assert.ok(rows.length > 0, 'the ledger must fill on an ordinary write');
  assert.ok(rows.every((r) => r.ran === true && r.blocked === false));
  assert.ok(rows.every((r) => r.surface === 'session'), 'session cadence must be attributed');
  assert.ok(rows.every((r) => Number.isFinite(r.elapsed_ms)), 'cost must be recorded');
});

test('a BLOCKED write records blocked=true against the check that blocked', async () => {
  const projectDir = makeHookProject([HOOK]);
  const file = srcFile(projectDir, 'src/secret.py', '');
  const res = await runHook(projectDir, HOOK, {
    tool_name: 'Write', tool_input: { file_path: file, content: `KEY = "${FAKE_AWS_KEY}"\n` },
  }, ENV);
  assert.strictEqual(res.status, 2, 'the write must be blocked');
  const blocked = ledger(projectDir).filter((r) => r.blocked);
  assert.strictEqual(blocked.length, 1, 'exactly the blocking check is recorded as blocked');
  assert.strictEqual(blocked[0].sensor, 'secret-scan-write');
  assert.strictEqual(blocked[0].surface, 'session');
});

test('checks that ran before the blocking one are still recorded as passing', async () => {
  const projectDir = makeHookProject([HOOK]);
  const file = srcFile(projectDir, 'src/secret.py', '');
  await runHook(projectDir, HOOK, {
    tool_name: 'Write', tool_input: { file_path: file, content: `KEY = "${FAKE_AWS_KEY}"\n` },
  }, ENV);
  const rows = ledger(projectDir);
  assert.ok(rows.some((r) => r.sensor === 'write-scope' && r.blocked === false),
    'an early passing check must not be lost when a later one blocks');
});

// --- scope ---

test('blocks a write outside the project directory', async () => {
  const projectDir = makeHookProject([HOOK]);
  const outside = path.join(makeHookProject([]), 'src', 'evil.ts');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: outside, content: 'const a = 1;\n' },
  }, ENV);
  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('outside project directory'), result.stdout);
});

// --- env protection ---

test('blocks writing .env but allows .env.example', async () => {
  const projectDir = makeHookProject([HOOK]);
  const blocked = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, '.env'), content: 'KEY=value\n' },
  }, ENV);
  assert.strictEqual(blocked.status, 2);
  assert.ok(blocked.stdout.includes('environment files'), blocked.stdout);

  const allowed = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, '.env.example'), content: 'KEY=\n' },
  }, ENV);
  assert.strictEqual(allowed.status, 0);
});

// --- secrets: scan the NEW content only ---

test('blocks a Write whose content contains a secret', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(projectDir, 'src', 'config.ts'),
      content: `const key = "${FAKE_AWS_KEY}";\n`,
    },
  }, ENV);
  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('AWS Access Key'), result.stdout);
});

test('does not block an unrelated Edit to a file with a pre-existing flagged string', async () => {
  // Regression for the detect-secrets whole-file-scan bug: a fixture string
  // already on disk must not block future unrelated edits.
  const projectDir = makeHookProject([HOOK]);
  const p = srcFile(projectDir, 'src/fixture.ts', `const ssn = "${FAKE_SSN}";\nconst a = 1;\n`);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Edit',
    tool_input: { file_path: p, old_string: 'const a = 1;', new_string: 'const a = 2;' },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('blocks a MultiEdit that inserts a secret', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = srcFile(projectDir, 'src/api.ts', 'const a = 1;\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: p,
      edits: [{ old_string: 'const a = 1;', new_string: `const t = "${FAKE_GH_TOKEN}";` }],
    },
  }, ENV);
  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('GitHub Token'), result.stdout);
});

// --- custom security patterns ---

test('blocks content matching a block:true rule in security-patterns.json', async () => {
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'security-patterns.json'),
    JSON.stringify({ patterns: [{ rule_name: 'no-eval', substrings: ['eval('], block: true, reminder: 'eval is banned' }] })
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'x.ts'), content: 'eval("1");\n' },
  }, ENV);
  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('no-eval'), result.stdout);
});

// --- single length limit (300) ---

test('blocks a Write that reaches 300 lines', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'big.ts'), content: lines(300) },
  }, ENV);
  assert.strictEqual(result.status, 2);
  assert.ok(/300 lines|hard limit/.test(result.stdout), result.stdout);
});

test('blocks a MultiEdit that pushes an existing file over the limit', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = srcFile(projectDir, 'src/module.ts', lines(295));
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: p,
      edits: [{ old_string: 'const v0 = 0;', new_string: lines(10, 'big').trimEnd() }],
    },
  }, ENV);
  assert.strictEqual(result.status, 2, `expected block, got ${result.status}: ${result.stdout}`);
});

test('allows an Edit that stays under the limit', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = srcFile(projectDir, 'src/module.ts', lines(100));
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Edit',
    tool_input: { file_path: p, old_string: 'const v0 = 0;', new_string: 'const v0 = 42;' },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

test('does not block when old_string is missing (the tool itself will fail)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = srcFile(projectDir, 'src/module.ts', lines(295));
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Edit',
    tool_input: { file_path: p, old_string: 'NOT PRESENT', new_string: lines(50) },
  }, ENV);
  assert.strictEqual(result.status, 0, result.stdout);
});

// --- function length ---

test('blocks a function longer than 30 lines', async () => {
  const projectDir = makeHookProject([HOOK]);
  const body = Array.from({ length: 33 }, (_, i) => `  const x${i} = ${i};`).join('\n');
  const content = `function huge() {\n${body}\n}\n`;
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'fn.ts'), content },
  }, ENV);
  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('huge'), result.stdout);
});

// --- TDD test-first ---

test('blocks a source write with no test anywhere', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'service.ts'), content: 'export const s = 1;\n' },
  });
  assert.strictEqual(result.status, 2);
  assert.ok(result.stdout.includes('test-first'), result.stdout);
});

test('allows a source write when a co-located test exists', async () => {
  const projectDir = makeHookProject([HOOK]);
  srcFile(projectDir, 'src/service.test.ts', 'test("s", () => {});\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'service.ts'), content: 'export const s = 1;\n' },
  });
  assert.strictEqual(result.status, 0, result.stdout);
});

test('always allows writing test files', async () => {
  const projectDir = makeHookProject([HOOK]);
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'tests', 'api.test.ts'), content: 'test("a", () => {});\n' },
  });
  assert.strictEqual(result.status, 0, result.stdout);
});

test('HARNESS_TDD_GATE=off disables only the TDD layer, not the others', async () => {
  const projectDir = makeHookProject([HOOK]);
  const ok = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, 'src', 'untested.ts'), content: 'const a = 1;\n' },
  }, ENV);
  assert.strictEqual(ok.status, 0, ok.stdout);

  const stillBlocked = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectDir, '.env'), content: 'K=v\n' },
  }, ENV);
  assert.strictEqual(stillBlocked.status, 2);
});

// Trust-boundary (harness machinery) and Claude Code per-project memory
// directory tests live in pre-write-gate-machinery.test.js.
