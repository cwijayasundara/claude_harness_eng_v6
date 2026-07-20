const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'verify-on-save.js';

function writeFileIn(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

test('a normal source write passes without emitting per-write chatter', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/service.js', 'module.exports = 1;\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.strictEqual(result.stdout, '', 'no context spam on every write');
});

test('blocks a Python layer violation (service importing api)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/service/user.py', 'from src.api import routes\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('service cannot import from api'), result.stdout);
});

test('passes a Python file with a legal downward import', async () => {
  const projectDir = makeHookProject([HOOK]);
  // Real package layout so a provisioned mypy/ruff can resolve the import.
  writeFileIn(projectDir, 'src/__init__.py', '');
  writeFileIn(projectDir, 'src/service/__init__.py', '');
  writeFileIn(projectDir, 'src/repository/__init__.py', '');
  writeFileIn(projectDir, 'src/repository/users.py', 'X: int = 1\n');
  const p = writeFileIn(
    projectDir,
    'src/service/user.py',
    'from src.repository import users\n\n__all__ = ["users"]\n'
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('does not lint, typecheck, or layer-check fixture files', async () => {
  const projectDir = makeHookProject([HOOK]);
  // Layer-violating content under test/fixtures/ — fixture data, not production code.
  const p = writeFileIn(
    projectDir,
    'test/fixtures/sample/src/service/user.py',
    'from src.api import routes\n'
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('treats "npx canceled due to missing packages" as unprovisioned, not a failure', () => {
  const { unavailable } = require(path.join(
    __dirname, '..', '.claude', 'hooks', 'lib', 'toolchain.js'
  ));
  assert.strictEqual(
    unavailable('npm error npx canceled due to missing packages and no YES option: ["eslint@10.4.1"]'),
    true
  );
});

test('resolveAdvisory reads the manifest flag and env override, defaulting to blocking', () => {
  const { resolveAdvisory } = require(path.join(
    __dirname, '..', '.claude', 'hooks', 'verify-on-save.js'
  ));
  assert.strictEqual(resolveAdvisory({ quality: { verify_on_save: 'advisory' } }, {}), true);
  assert.strictEqual(resolveAdvisory({ quality: { verify_on_save: 'blocking' } }, {}), false);
  assert.strictEqual(resolveAdvisory(null, {}), false, 'default is blocking');
  assert.strictEqual(resolveAdvisory(null, { HARNESS_VERIFY_ADVISORY: '1' }), true, 'env override wins');
  assert.strictEqual(resolveAdvisory({ quality: { verify_on_save: 'advisory' } }, { HARNESS_VERIFY_ADVISORY: '0' }), true);
});

test('advisory mode does NOT downgrade the architecture (layer) block', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/service/user.py', 'from src.api import routes\n');
  writeFileIn(projectDir, 'project-manifest.json', JSON.stringify({ quality: { verify_on_save: 'advisory' } }));
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  // Layer/context invariants stay blocking regardless of advisory mode — only
  // the lint/typecheck toolchain becomes advisory.
  assert.strictEqual(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('service cannot import from api'), result.stdout);
});

test('does not block when the lint/typecheck toolchain is unprovisioned', async () => {
  // Temp project has no pyproject/eslint config — the hook must fail open.
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/svc.py', 'x: int = 1\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  }, { PATH: '/nonexistent' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});
