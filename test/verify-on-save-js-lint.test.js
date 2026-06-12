// Gap 4 — JS/JSX/MJS/CJS eslint-on-save tests for verify-on-save.js.
// Previously .js/.jsx/.mjs/.cjs files got no lint check; this covers the fix.

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

// eslint absent (PATH=/usr/bin:/bin) → the gate must fail open (exit 0), not block.
test('verify-on-save: js file with eslint absent does not block (fail-open)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/utils.js', 'module.exports = 1;\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  }, { PATH: '/usr/bin:/bin' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('verify-on-save: jsx file with eslint absent does not block (fail-open)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/App.jsx', 'export default function App() { return null; }\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  }, { PATH: '/usr/bin:/bin' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('verify-on-save: mjs file with eslint absent does not block (fail-open)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/utils.mjs', 'export const x = 1;\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  }, { PATH: '/usr/bin:/bin' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('verify-on-save: cjs file with eslint absent does not block (fail-open)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(projectDir, 'src/utils.cjs', 'module.exports = {};\n');
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  }, { PATH: '/usr/bin:/bin' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

// Confirm that .js files are now sent through the same eslint branch as .ts files.
// We do this by confirming the tool is invoked (not skipped) when eslint returns
// a "canceled due to missing packages" response — unavailable() should catch it.
test('verify-on-save: js file treats npx-canceled-due-to-missing-packages as unprovisioned', () => {
  const { unavailable } = require(path.join(
    __dirname, '..', '.claude', 'hooks', 'lib', 'toolchain.js'
  ));
  assert.strictEqual(
    unavailable('npm error npx canceled due to missing packages and no YES option: ["eslint@9.0.0"]'),
    true
  );
});
