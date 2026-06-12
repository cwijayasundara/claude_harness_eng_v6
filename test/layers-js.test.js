// Gap 3 — JS/TS layer enforcement tests.
// Covers the JS/TS analog in layers.js (checkContentViolations) and the
// corresponding verify-on-save path. Mirrors verify-on-save.test.js structure.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

// --- Unit tests for checkContentViolations (JS/TS path) ---

const { checkContentViolations, getLayer, getHigherLayers } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'layers')
);

test('getLayer returns null for a file outside any recognised layer', () => {
  assert.strictEqual(getLayer('src/utils/helpers.js'), null);
});

test('getLayer recognises ui layer for JS files', () => {
  assert.strictEqual(getLayer('src/ui/Button.tsx'), 'ui');
});

test('getLayer recognises service layer for TS files', () => {
  assert.strictEqual(getLayer('src/service/UserService.ts'), 'service');
});

test('getHigherLayers returns layers above service', () => {
  const higher = getHigherLayers('service');
  assert.ok(higher.includes('api'), 'api should be above service');
  assert.ok(higher.includes('ui'), 'ui should be above service');
  assert.ok(!higher.includes('repository'), 'repository should not be above service');
});

test('checkContentViolations detects JS import from a higher layer (repository → service)', () => {
  const content = "import { UserService } from '../service/UserService';\n";
  const violations = checkContentViolations('src/repository/UserRepo.js', content);
  assert.strictEqual(violations.length, 1, JSON.stringify(violations));
  assert.strictEqual(violations[0].layer, 'repository');
  assert.strictEqual(violations[0].imported, 'service');
});

test('checkContentViolations detects TS import from a higher layer (service → api)', () => {
  const content = "import { router } from '../api/router';\n";
  const violations = checkContentViolations('src/service/UserService.ts', content);
  assert.strictEqual(violations.length, 1, JSON.stringify(violations));
  assert.strictEqual(violations[0].layer, 'service');
  assert.strictEqual(violations[0].imported, 'api');
});

test('checkContentViolations detects TSX import from a higher layer (service → ui)', () => {
  const content = "import Button from '../ui/Button';\n";
  const violations = checkContentViolations('src/service/UserService.tsx', content);
  assert.strictEqual(violations.length, 1, JSON.stringify(violations));
  assert.strictEqual(violations[0].layer, 'service');
  assert.strictEqual(violations[0].imported, 'ui');
});

test('checkContentViolations allows a legal downward import (service → repository)', () => {
  const content = "import { UserRepo } from '../repository/UserRepo';\n";
  const violations = checkContentViolations('src/service/UserService.ts', content);
  assert.strictEqual(violations.length, 0, JSON.stringify(violations));
});

test('checkContentViolations allows a legal downward import (api → service)', () => {
  const content = "import { UserService } from '../service/UserService';\n";
  const violations = checkContentViolations('src/api/UserController.ts', content);
  assert.strictEqual(violations.length, 0, JSON.stringify(violations));
});

test('checkContentViolations detects require() upward import', () => {
  const content = "const { UserService } = require('../service/UserService');\n";
  const violations = checkContentViolations('src/repository/UserRepo.js', content);
  assert.strictEqual(violations.length, 1, JSON.stringify(violations));
  assert.strictEqual(violations[0].imported, 'service');
});

test('checkContentViolations ignores npm package imports (no slash prefix)', () => {
  const content = "import express from 'express';\nimport _ from 'lodash';\n";
  const violations = checkContentViolations('src/service/UserService.ts', content);
  assert.strictEqual(violations.length, 0, JSON.stringify(violations));
});

test('checkContentViolations ignores comment lines', () => {
  const content = "// import { x } from '../api/routes';\n/* import { y } from '../ui/App' */\n";
  const violations = checkContentViolations('src/service/UserService.ts', content);
  assert.strictEqual(violations.length, 0, JSON.stringify(violations));
});

test('checkContentViolations returns empty for a file not in any layer directory', () => {
  const content = "import { something } from '../api/router';\n";
  const violations = checkContentViolations('src/utils/helpers.ts', content);
  assert.strictEqual(violations.length, 0, JSON.stringify(violations));
});

test('checkContentViolations still handles Python files correctly', () => {
  const content = 'from src.service import logic\n';
  const violations = checkContentViolations('src/repository/db.py', content);
  assert.strictEqual(violations.length, 1, JSON.stringify(violations));
  assert.strictEqual(violations[0].layer, 'repository');
  assert.strictEqual(violations[0].imported, 'service');
});

// --- Integration tests: verify-on-save blocks JS/TS layer violations ---

function writeFileIn(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

const HOOK = 'verify-on-save.js';

test('verify-on-save: blocks a JS layer violation (repository importing service)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(
    projectDir,
    'src/repository/UserRepo.js',
    "import { UserService } from '../service/UserService';\n"
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('repository cannot import from service'), result.stdout);
});

test('verify-on-save: blocks a TS layer violation (service importing ui)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(
    projectDir,
    'src/service/UserService.ts',
    "import Button from '../ui/Button';\n"
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('service cannot import from ui'), result.stdout);
});

test('verify-on-save: passes a legal TS downward import (api → service)', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(
    projectDir,
    'src/api/UserController.ts',
    "import { UserService } from '../service/UserService';\n"
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('verify-on-save: passes a JS file outside any layer directory', async () => {
  const projectDir = makeHookProject([HOOK]);
  const p = writeFileIn(
    projectDir,
    'src/utils/helpers.js',
    "import { foo } from '../api/router';\n"
  );
  const result = await runHook(projectDir, HOOK, {
    tool_name: 'Write',
    tool_input: { file_path: p },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});
