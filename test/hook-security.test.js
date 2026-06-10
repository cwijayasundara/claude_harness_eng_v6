const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

// Regression tests for the security review of the consolidated hooks (a2dc755).

function writeFileIn(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

// VULN-001 — command injection via a crafted file path in verify-on-save.
test('verify-on-save does not execute commands embedded in the file path', async () => {
  const projectDir = makeHookProject(['verify-on-save.js']);
  // Provide a manifest so the lint branch is taken (ruff). Even with the
  // toolchain present this must not execute the embedded command.
  fs.writeFileSync(path.join(projectDir, 'project-manifest.json'), JSON.stringify({ linter: 'ruff', typechecker: 'mypy' }));
  const marker = path.join(os.tmpdir(), `pwned-${process.pid}-${Date.now()}`);
  const evil = writeFileIn(projectDir, `src/x$(touch ${marker}).py`, 'x = 1\n');

  await runHook(projectDir, 'verify-on-save.js', {
    tool_name: 'Write',
    tool_input: { file_path: evil },
  });

  assert.strictEqual(fs.existsSync(marker), false, 'embedded command must NOT have run');
});

test('verify-on-save does not execute backtick command substitution in the path', async () => {
  const projectDir = makeHookProject(['verify-on-save.js']);
  fs.writeFileSync(path.join(projectDir, 'project-manifest.json'), JSON.stringify({ linter: 'eslint' }));
  const marker = path.join(os.tmpdir(), `pwned-bt-${process.pid}-${Date.now()}`);
  const evil = writeFileIn(projectDir, 'src/x`touch ' + marker + '`.ts', 'const a = 1;\n');

  await runHook(projectDir, 'verify-on-save.js', {
    tool_name: 'Write',
    tool_input: { file_path: evil },
  });

  assert.strictEqual(fs.existsSync(marker), false, 'embedded command must NOT have run');
});

// VULN-002/003 — the /tmp scope allowance must not let a symlink or sibling
// directory escape the project, and must still resolve symlinks.
test('pre-write-gate blocks a /tmp-sibling path that is not actually under /tmp', async () => {
  const projectDir = makeHookProject(['pre-write-gate.js']);
  const result = await runHook(projectDir, 'pre-write-gate.js', {
    tool_name: 'Write',
    tool_input: { file_path: '/tmpevil/escape.ts', content: 'const a = 1;\n' },
  }, { HARNESS_TDD_GATE: 'off' });
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(result.stdout.includes('outside project directory'), result.stdout);
});

// VULN-004 — secret-scan exemption must be anchored to the harness's own
// .claude/ tree, not any path containing /hooks/ or /templates/.
test('pre-write-gate scans secrets in an app src/hooks/ directory', async () => {
  const projectDir = makeHookProject(['pre-write-gate.js']);
  const awsKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const result = await runHook(projectDir, 'pre-write-gate.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(projectDir, 'src', 'hooks', 'useAuth.ts'),
      content: `const k = "${awsKey}";\n`,
    },
  }, { HARNESS_TDD_GATE: 'off' });
  assert.strictEqual(result.status, 2, result.stdout);
  assert.ok(result.stdout.includes('AWS Access Key'), result.stdout);
});

test('pre-write-gate still exempts the harness own .claude/hooks tree', async () => {
  const projectDir = makeHookProject(['pre-write-gate.js']);
  const ssn = ['123', '45', '6789'].join('-');
  const result = await runHook(projectDir, 'pre-write-gate.js', {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(projectDir, '.claude', 'hooks', 'lib', 'fixture.js'),
      content: `const ssn = "${ssn}";\n`,
    },
  }, { HARNESS_TDD_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout);
});
