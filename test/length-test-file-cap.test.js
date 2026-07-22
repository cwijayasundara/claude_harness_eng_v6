'use strict';

// Test files get a higher file cap than source. The 300-line source cap exists
// because a long source file concentrates change; a test file is read one case
// at a time and grows table-wise, so the same argument does not apply. The
// FUNCTION cap is deliberately unchanged — a 30-line test case is still a smell.

const assert = require('assert');
const { test } = require('node:test');

const {
  FILE_HARD_LIMIT, TEST_FILE_LIMIT, isTestPath, fileLimitFor, newlyOverFileLimit,
} = require('../.claude/hooks/lib/length.js');

test('the source cap is unchanged at 300 and the test cap is higher', () => {
  assert.strictEqual(FILE_HARD_LIMIT, 300);
  assert.strictEqual(TEST_FILE_LIMIT, 500);
  assert.ok(TEST_FILE_LIMIT > FILE_HARD_LIMIT);
});

test('paths under a test directory are test paths', () => {
  for (const p of [
    'test/foo.test.js', 'tests/foo.py', '__tests__/foo.tsx',
    'e2e/login.spec.ts', 'src/__tests__/unit.js', 'packages/api/test/handler.test.ts',
  ]) {
    assert.strictEqual(isTestPath(p), true, `${p} should be a test path`);
  }
});

test('files named as tests are test paths wherever they live', () => {
  for (const p of [
    'src/auth/service.test.ts', 'src/auth/service.spec.js',
    'app/test_service.py', 'app/service_test.py', 'pkg/handler_test.go',
  ]) {
    assert.strictEqual(isTestPath(p), true, `${p} should be a test path`);
  }
});

test('production code is never mistaken for a test, including near-miss names', () => {
  for (const p of [
    'src/auth/service.ts', 'src/testing/harness.ts', 'src/latest/index.js',
    'src/contest/entry.py', 'lib/protest.go', 'src/test-utils.ts', 'attest/bundle.js',
  ]) {
    assert.strictEqual(isTestPath(p), false, `${p} must NOT be treated as a test path`);
  }
});

test('backslash paths are normalised before matching', () => {
  assert.strictEqual(isTestPath('test\\foo.test.js'), true);
  assert.strictEqual(isTestPath('src\\auth\\service.ts'), false);
});

test('fileLimitFor returns the right cap per path', () => {
  assert.strictEqual(fileLimitFor('test/a.test.js'), TEST_FILE_LIMIT);
  assert.strictEqual(fileLimitFor('src/a.ts'), FILE_HARD_LIMIT);
});

test('a new 400-line test file is allowed; a new 400-line source file is not', () => {
  assert.strictEqual(newlyOverFileLimit(null, 400, fileLimitFor('test/a.test.js')), false);
  assert.strictEqual(newlyOverFileLimit(null, 400, fileLimitFor('src/a.ts')), true);
});

test('the test cap is a real cap, not an exemption', () => {
  assert.strictEqual(newlyOverFileLimit(null, 501, fileLimitFor('test/a.test.js')), true);
});

test('the ratchet still applies to test files: grandfathered unless grown', () => {
  const limit = fileLimitFor('test/a.test.js');
  assert.strictEqual(newlyOverFileLimit(600, 600, limit), false, 'unchanged legacy file passes');
  assert.strictEqual(newlyOverFileLimit(600, 601, limit), true, 'growing it further blocks');
  assert.strictEqual(newlyOverFileLimit(600, 550, limit), false, 'shrinking it passes');
  assert.strictEqual(newlyOverFileLimit(499, 501, limit), true, 'newly crossing blocks');
});
